'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from "fs";
import {normalize, sep} from "path";
import {getBranch, isBranchMatch, isProjectJS} from "./utils";



namespace LocalizeResourceProvider {
    export interface LanguagePack {
        [key: string]: any;
    }
    
    export interface LocalizeResource {
        document: vscode.TextDocument;
        data: LanguagePack;
        dispose: Function;
    }
    
    const resourceCache: {
        [key: string]: {
            documents: Array<vscode.TextDocument>;
            data: LanguagePack
        }
    } = {};
    function removeCacheFor(doc: vscode.TextDocument) {
        let resourceFile;
        Object.keys(resourceCache).forEach(key => {
            let docs = resourceCache[key].documents;
            let docIndex = docs.indexOf(doc);
            if(docIndex > -1) {
                docs.splice(docIndex, 1);
            }
            resourceFile = key;
        });
        if(!resourceFile) { return; }
        if(resourceCache[resourceFile].documents.length === 0) {
            delete resourceCache[resourceFile];
        }
    }
    function register(doc: vscode.TextDocument, resourceFile: string, resourceData: LanguagePack) {
        if(!resourceCache.hasOwnProperty(resourceFile)) {
            resourceCache[resourceFile] = {
                data: resourceData,
                documents: []
            };
        }
        resourceCache[resourceFile].documents.push(doc);
    }
    export function prepare(doc: vscode.TextDocument): Promise<LocalizeResource> {
        if(doc.languageId !== "html") {
            throw new Error("only support html file!");
        }
        let config = vscode.workspace.getConfiguration("vdife");
        let ngconsoleRoot = normalize(config.ngconsole + sep);
        let ngconsoleResourcesRoot = normalize(config.ngconsole_resources + sep);
        if(!doc.fileName.startsWith(ngconsoleRoot)) {
            throw new Error("not ngconsole document");
        }
        return Promise.all([
            getBranch(ngconsoleRoot),
            getBranch(ngconsoleResourcesRoot)
        ]).then(function(arr){
            if(!isBranchMatch(...arr)) {
                throw new Error("ngconsole, ngconsole_resources 仓库分支不匹配！");
            }
            let parts = arr[0].split("-");
            let name = parts.length === 3 ? parts[2] : "e-vdi";
            let resourceFile = `${config.ngconsole_resources}/resources/pkg/${name}/lang.json`;
            return new Promise<LocalizeResource>(function(resolve, reject){
                fs.readFile(resourceFile, "utf-8", function(err, text){
                    if(err) {
                        return reject(err);
                    }
                    let lp = JSON.parse(text) as LanguagePack;
                    register(doc, resourceFile, lp);
                    resolve({
                        document: doc,
                        data: lp,
                        dispose: removeCacheFor.bind(null, doc)
                    });
                });
            });
        });
    }
    export function getLanguagePack(doc: vscode.TextDocument): LanguagePack | undefined {
        let hit;
        Object.keys(resourceCache).forEach(key => {
            let documents = resourceCache[key].documents;
            if(documents.indexOf(doc) > -1) {
                hit = resourceCache[key].data;
            }
        });
        return hit;
    }
    export function saveLanguagePack(lang: LanguagePack) {
        Object.keys(resourceCache).forEach(file => {
            if(resourceCache[file].data === lang) {
                fs.writeFile(file, JSON.stringify(lang, null, 4), function(err){
                    err && vscode.window.showErrorMessage(`保存 ${file} 时报错：${err.message}`);
                });
            }
        });
    }
    export function dispose(){
        Object.keys(resourceCache).forEach(file => delete resourceCache[file]);
    }
}

namespace decorations {
    const existsDecoration = vscode.window.createTextEditorDecorationType({
        overviewRulerColor: '#3eb94e',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        light: {
            color: "white",
            backgroundColor: '#3eb94e'
        },
        dark: {
            color: "white",
            backgroundColor: '#3eb94e'
        }
    });
    const missingDecoration = vscode.window.createTextEditorDecorationType({
        overviewRulerColor: '#f2554e',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        light: {
            color: "white",
            backgroundColor: '#f2554e'
        },
        dark: {
            color: "white",
            backgroundColor: '#f2554e'
        }
    });
    const interpolateDecoration = vscode.window.createTextEditorDecorationType({
        light: {
            border: "1px solid #fdbc40",
            borderRadius: "3px"
        },
        dark: {
            border: "1px solid #fdbc40",
            borderRadius: "3px"
        }
    });
    const deprecatedAPIDecoration = vscode.window.createTextEditorDecorationType({
        light: {
            border: "1px solid #f2554e",
            borderRadius: "3px"
        },
        dark: {
            border: "1px solid #f2554e",
            borderRadius: "3px"
        }
    });
    export const regexp = /(?:data-)?localize=(["'])(.*?)\1/mg;
    const interpolateRegExp = /\{\{.*?\}\}/

    function highlightLocalize(editor: vscode.TextEditor) {
        let doc = editor.document;
        let resourceData = LocalizeResourceProvider.getLanguagePack(doc);
        if(!resourceData) { return; }
        let range = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        let renderExistsList: vscode.DecorationOptions[] = [];
        let renderMissingList: vscode.DecorationOptions[] = [];
        let renderinterpolateList: vscode.DecorationOptions[] = [];
    
        let text = editor.document.getText(range);
        let result;
        let startPos: vscode.Position, endPos: vscode.Position;
        let decoration: vscode.DecorationOptions;
        let commentRanges = getHtmlCommentRanges(text, doc);
        let isInComment = false;
        regexp.lastIndex = 0;
        while((result = regexp.exec(text))) {
            startPos = doc.positionAt(result.index);
            endPos = doc.positionAt(result.index + result[0].length);
            decoration = {
                range: new vscode.Range(startPos, endPos)
            };
            // 忽略注释中的 localize
            isInComment = commentRanges.some(range => range.contains(decoration.range));
            if(isInComment) {
                continue;
            }
            if(interpolateRegExp.test(result[2])) {
                renderinterpolateList.push(decoration);
            } else {
                if(resourceData.hasOwnProperty(result[2])) {
                    renderExistsList.push(decoration);
                } else {
                    renderMissingList.push(decoration);
                }
            }
        }
    
        editor.setDecorations(existsDecoration, renderExistsList);
        editor.setDecorations(missingDecoration, renderMissingList);
        editor.setDecorations(interpolateDecoration, renderinterpolateList);
    }

    /**
     * 获取指定 html 字符串中注释 range 列表
     * @param text html 字符串
     */
    function getHtmlCommentRanges(text: string, doc: vscode.TextDocument): vscode.Range[] {
        let ranges: vscode.Range[] = [];
        const commentStart = "<!--";
        const commentEnd = "-->";
        let pos1, pos2 = 0;
        while((pos1 = text.indexOf(commentStart, pos2)) !== -1) {
            pos2 = text.indexOf(commentEnd, pos1);
            if(pos2 !== -1) {
                ranges.push(new vscode.Range(doc.positionAt(pos1), doc.positionAt(pos2)));
            }
        }
        return ranges;
    }

    const deprecatedAPIInfos = [
        [/\$\$\$I18N\.get\(.*?\)/g, "`$$$I18N.get()` 已弃用，请使用 `i18n.translateText()` 代替"],
        [/\$\$\$MSG\.get\(.*?\)/g, "`$$$MSG.get()` 已弃用，请使用 `i18n.translateCode()` 代替"],
        [/\$\.bigBox\(\{[\s\S]*?\}\);?/mg, "`$.bigBox({ ... })` 已弃用，请使用 `uihelper.alertXXX()` 代替"],
        [/\$modal\.open\(\{\s+template\s*:\s*"<section id='widget-grid'>[\s\S]*?controller\s*:[\s\S]*?size\s*:[\s\S]*?\}\);?/mg, "请使用 `uihelper.confirmWithModal({ ... })`代替"]
    ];
    function highlightDeprecatedAPI(editor: vscode.TextEditor) {
        let doc = editor.document;
        // 忽略:
        //   js/vdi/utils/ui.js 这个文件封装了 $.bigBox 调用
        if(doc.fileName.indexOf(`js${sep}vdi${sep}utils${sep}ui.js`) > -1) {
            return;
        }
        let text = doc.getText();
        let renderList: vscode.DecorationOptions[] = [];
        deprecatedAPIInfos.forEach(info => {
            let regexp = info[0] as RegExp;
            let message = info[1] as string;
            regexp.lastIndex = 0;
            let result;
            let startPos: vscode.Position, endPos: vscode.Position;
            let decoration: vscode.DecorationOptions;
            while((result = regexp.exec(text))) {
                startPos = doc.positionAt(result.index);
                endPos = doc.positionAt(result.index + result[0].length);
                decoration = {
                    range: new vscode.Range(startPos, endPos),
                    hoverMessage: message
                };
                renderList.push(decoration);
            }
        });
        editor.setDecorations(deprecatedAPIDecoration, renderList);
    }

    export function highlight(editor: vscode.TextEditor) {
        let doc = editor.document;
        if(doc.languageId === "html") {
            highlightLocalize(editor);
        } else if(doc.languageId === "javascript" && isProjectJS(doc.fileName)) {
            highlightDeprecatedAPI(editor);
        }
    }
}


export function activate(context: vscode.ExtensionContext) {
    if(!vscode.extensions.getExtension("dbaeumer.vscode-eslint")) {
        vscode.window.showInformationMessage("请安装 ESLint 扩展！");
    }
    let config = vscode.workspace.getConfiguration("vdife");
    if(!checkConfigrations(config)) { return; }
    let cache: LocalizeResourceProvider.LocalizeResource[] = [];
    // 手动执行 "同步 localize" 命令时
    context.subscriptions.push(vscode.commands.registerTextEditorCommand("vdife.syncLocalize", (textEditor, edit) => {
        if(textEditor.document.languageId !== "html") {
            return;
        }
        let doc = textEditor.document;
        let resourceData: LocalizeResourceProvider.LanguagePack|undefined;
        cache.forEach(function(resource){
            if(resource.document === doc) {
                resourceData = resource.data;
            }
        });
        if(!resourceData) { return; }
        let text = doc.getText();
        let hasNewLocalize = false;
        let allRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
        let newText = text.replace(decorations.regexp, function(m, key){
            if(resourceData && !resourceData.hasOwnProperty(key)) {
                hasNewLocalize = true;
                resourceData[key] = key;
            }
            return m.indexOf("data-") === 0 ? m.substring(5) : m;
        });
        if(hasNewLocalize) {
            LocalizeResourceProvider.saveLanguagePack(resourceData);
            textEditor.edit(function(edit){
                edit.replace(allRange, newText);
            });
        }
    }));
    // 新增 localize
    context.subscriptions.push(vscode.commands.registerTextEditorCommand("vdife.newLocalize", (textEditor) => {
        let inputValueRegexp = /^\s*(.+?)\s*=\s*(.+?)\s*$/
        let selectedText = textEditor.document.getText(textEditor.selection);
        let placeHolder = "输入格式：key=value";
        vscode.window.showInputBox({
            value: selectedText,
            ignoreFocusOut: false,
            prompt: placeHolder,
            placeHolder: placeHolder,
            valueSelection: [0, selectedText.length],
            validateInput: function(value){
                return inputValueRegexp.test(value) ? "" : placeHolder;
            }
        }).then(function(text){
            if(!text) { return; }
            let result = inputValueRegexp.exec(text);
            let lang = LocalizeResourceProvider.getLanguagePack(textEditor.document);
            if(result && lang) {
                lang[result[1]] = result[2];
                LocalizeResourceProvider.saveLanguagePack(lang);
            }
        });
    }));
    // 打开 html 时缓存必要的资源信息
    const onOpen = function(doc: vscode.TextDocument){
        if(doc.languageId !== "html") { return; }
        try {
            LocalizeResourceProvider.prepare(doc).then(function(resource){
                cache.push(resource);
                // 加载完资源后，检测一次当前可见的编辑器，如果仍然可见，则执行高亮
                vscode.window.visibleTextEditors.forEach(editor => {
                    if(editor.document === doc) {
                        decorations.highlight(editor);
                    }
                });
            }, function(e){
                vscode.window.showErrorMessage(e.message);
            });
        } catch(e) {
            // ignore
        }
    };
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(onOpen));
    // 关闭 html 时删除缓存
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(function(doc){
        let index = -1;
        cache.forEach(function(resource, i){
            if(resource.document === doc) {
                index = i;
                resource.dispose();
            }
        });
        if(index > -1) {
            cache.splice(index, 1);
        }
    }));
    // 文档打开时，编辑器并未就绪，所以等待编辑器可见后设置装饰器
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(function(e){
        if(!e) { return; }
        decorations.highlight(e);
    }));
    // 文本发生变化的前提是编辑器已经就绪，此时更新装饰器
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(function(e){
        let editor = vscode.window.activeTextEditor;
        editor && decorations.highlight(editor);
    }));
    // 注册闭包缓存清理
    context.subscriptions.push({
        dispose: function(){
            while(cache.length > 0) {
                cache.pop();
            }
        }
    });
    // 对已经可见的编辑器做一次检测
    vscode.window.visibleTextEditors.forEach(editor => onOpen(editor.document));
}

// this method is called when your extension is deactivated
export function deactivate() {
    
}


function checkConfigrations(config: vscode.WorkspaceConfiguration){
    let ngconsoleRoot: string = config.ngconsole;
    let ngconsoleResourcesRoot: string = config.ngconsole_resources;
    if(!ngconsoleRoot) {
        vscode.window.showErrorMessage("您还没有配置 ngconsole 仓库路径！");
        return false;
    }
    if(!ngconsoleResourcesRoot) {
        vscode.window.showErrorMessage("您还没有配置 ngconsole_resources 仓库路径！");
        return false;
    }
    return true;
}