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
            // 使用 `...arr` 会报错：Expected 2 arguments, but got 0 or more.
            if(!isBranchMatch(arr[0], arr[1])) {
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

namespace diagnostics {
    interface DeprecatedAPIInfo {
        regexp: RegExp;
        message: string,
        fix?: Function
    }
    const deprecatedAPIInfos: DeprecatedAPIInfo[] = [{
        regexp: /\$\$\$I18N\.get\((.*?)\)/g,
        message: "`$$$I18N.get()` 已弃用，请使用 `i18n.translateText()` 代替",
        fix: function(code: string): string{
            let result = this.regexp.exec(code);
            return result ? `i18n.translateText(${result[1]})` : code;
        }
    }, {
        regexp: /\$\$\$MSG\.get\((.*?)\)/g,
        message: "`$$$MSG.get()` 已弃用，请使用 `i18n.translateCode()` 代替",
        fix: function(code: string): string{
            let result = this.regexp.exec(code);
            return result ? `i18n.translateCode(${result[1]})` : code;
        }
    }, {
        regexp: /\$\.bigBox\(\{[\s\S]*?\}\);?/mg,
        message: "`$.bigBox({ ... })` 已弃用，请使用 `uihelper.alertXXX()` 代替"
    }, {
        regexp: /\$modal\.open\(\{\s+template\s*:\s*"<section id='widget-grid'>[\s\S]*?controller\s*:[\s\S]*?size\s*:[\s\S]*?\}\);?/mg,
        message: "请使用 `uihelper.confirmWithModal({ ... })`代替"
    }];

    export class DeprecatedAPIProvider implements vscode.CodeActionProvider {
        private diagnosticName = "ngconsole 弃用 API";
        private collection: vscode.DiagnosticCollection;
        constructor(context: vscode.ExtensionContext) {
            this.collection = vscode.languages.createDiagnosticCollection(this.diagnosticName);
            context.subscriptions.push(
                vscode.languages.registerCodeActionsProvider("javascript", this),
                vscode.workspace.onDidOpenTextDocument((e) => this.updateDiagnostics(e)),
                vscode.workspace.onDidChangeTextDocument((e) => this.updateDiagnostics(e.document)),
                vscode.workspace.onDidCloseTextDocument((e) => this.removeDiagnostics(e))
            );
            vscode.workspace.textDocuments.forEach(doc => this.updateDiagnostics(doc));
        }
        provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
            let diagnostics = context.diagnostics.filter(p => p.source === this.diagnosticName);
            if(diagnostics.length === 0) { return []; }
            return diagnostics.map(p => <vscode.Command>{
                title: "转换为新 API",
                command: "vdife.fixDeprecated",
                arguments: [document, p.range]
            });
        }
        updateDiagnostics(doc: vscode.TextDocument){
            if(doc.languageId !== "javascript") { return; }
            // 忽略:
            if(!isProjectJS(doc.fileName)) { return; }
            //   js/vdi/utils/ui.js 这个文件封装了 $.bigBox 调用
            if(doc.fileName.indexOf(`js${sep}vdi${sep}utils${sep}ui.js`) > -1) {
                return;
            }
            let text = doc.getText();
            let diagnostics: vscode.Diagnostic[] = [];
            deprecatedAPIInfos.forEach(info => {
                let regexp = info.regexp;
                let message = info.message;
                regexp.lastIndex = 0;
                let result, tmp;
                let startPos: vscode.Position, endPos: vscode.Position;
                while((result = regexp.exec(text))) {
                    startPos = doc.positionAt(result.index);
                    endPos = doc.positionAt(result.index + result[0].length);
                    tmp = new vscode.Diagnostic(new vscode.Range(startPos, endPos), message, vscode.DiagnosticSeverity.Error);
                    if(info.fix) {
                        tmp.source = this.diagnosticName;
                    }
                    diagnostics.push(tmp);
                }
            });
            this.collection.set(doc.uri, diagnostics);
        }
        removeDiagnostics(doc: vscode.TextDocument) {
            this.collection.delete(doc.uri);
        }
        static fix(editor: vscode.TextEditor, range: vscode.Range) {
            let doc = editor.document;
            let code = doc.getText(range);
            let fixedCode = code;
            deprecatedAPIInfos.forEach(info => {
                if(!info.fix || !info.regexp.test(code)) { return; }
                info.regexp.lastIndex = 0;
                fixedCode = info.fix(code);
            });
            if(code === fixedCode) { return; }
            editor.edit(function(editBuilder){
                editBuilder.replace(range, fixedCode);
            });
        }
    }
    export const localizeRegExp = /(?:data-)?localize(?:-title|-placeholder|-href|-tip)?=(["'])(.+?)\1/mg;
    export class LocalizeProvider implements vscode.CodeActionProvider, vscode.HoverProvider, vscode.Disposable {
        
        private diagnosticName = "ngconsole_resoures";
        private collection: vscode.DiagnosticCollection;
        private interpolateRegExp = /\{\{.*?\}\}/;
        private hoverRegExp = /(?:data-)?localize(?:-title|-placeHolder|-href|-tip)?\s*=\s*["'].*?$/;
        private cache: LocalizeResourceProvider.LocalizeResource[] = [];
        constructor(context: vscode.ExtensionContext) {
            this.collection = vscode.languages.createDiagnosticCollection(this.diagnosticName);
            context.subscriptions.push(
                vscode.languages.registerCodeActionsProvider("html", this),
                vscode.languages.registerHoverProvider("html", this),
                vscode.workspace.onDidOpenTextDocument((e) => this.onOpenTextDocument(e)),
                vscode.workspace.onDidChangeTextDocument((e) => this.updateDiagnostics(e.document)),
                vscode.workspace.onDidCloseTextDocument((e) => this.onCloseTextDocument(e)),
                this
            );
            vscode.workspace.textDocuments.forEach(doc => this.onOpenTextDocument(doc));
        }
        provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
            let diagnostics = context.diagnostics.filter(p => p.source === this.diagnosticName).filter(p => p.severity === vscode.DiagnosticSeverity.Error);
            if(diagnostics.length === 0) { return []; }
            return diagnostics.map(p => <vscode.Command>{
                title: `添加翻译 ${p.code} 到 ngcnosole_resources`,
                command: "vdife.addLocalize",
                arguments: [document, p.code]
            });
        }
        provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
            if(document.languageId !== "html") { return; }
            let resourceData = LocalizeResourceProvider.getLanguagePack(document);
            if(!resourceData) {
                return null;
            }
            let text = document.getText(new vscode.Range(document.lineAt(position.line).range.start, position));
            if(this.hoverRegExp.test(text)) {
                let range = document.getWordRangeAtPosition(position);
                if(!range) { return null; }
                let resourceKey = document.getText(range);
                return <vscode.Hover>{
                    range: range,
                    contents: [{
                        value: "翻译内容：" + resourceData[resourceKey]
                    }]
                };
            }
            return null;
        }
        onOpenTextDocument(doc: vscode.TextDocument) {
            if(doc.languageId !== "html") { return; }
            try {
                LocalizeResourceProvider.prepare(doc).then((resource) => {
                    this.cache.push(resource);
                    this.updateDiagnostics(doc);
                }, function(e){
                    vscode.window.showErrorMessage(e.message);
                });
            } catch(e) {
                // ignore
            }
        }
        onCloseTextDocument(doc: vscode.TextDocument) {
            let index = -1;
            this.cache.forEach(function(resource, i){
                if(resource.document === doc) {
                    index = i;
                    resource.dispose();
                }
            });
            if(index > -1) {
                this.cache.splice(index, 1);
            }
        }
        updateDiagnostics(doc: vscode.TextDocument) {
            if(doc.languageId !== "html") { return; }
            let resourceData = LocalizeResourceProvider.getLanguagePack(doc);
            if(!resourceData) { return; }
        
            let text = doc.getText();
            let result, resourceKey;
            let startPos: vscode.Position, endPos: vscode.Position;
            let commentRanges = this.getHtmlCommentRanges(text, doc);
            let isInComment = false;
            let diagnostics: vscode.Diagnostic[] = [];
            let regexp = localizeRegExp;
            let range: vscode.Range, diagnostic;
            regexp.lastIndex = 0;
            while((result = regexp.exec(text))) {
                startPos = doc.positionAt(result.index);
                endPos = doc.positionAt(result.index + result[0].length);
                resourceKey = result[2].trim();
                range = new vscode.Range(startPos, endPos);
                // 忽略注释中的 localize
                isInComment = commentRanges.some(cr => cr.contains(range));
                if(isInComment) {
                    continue;
                }
                // 忽略 angular 插值语法
                if(this.interpolateRegExp.test(resourceKey)) {
                    continue;
                }
                if(!resourceData.hasOwnProperty(resourceKey)) {
                    diagnostic = new vscode.Diagnostic(range, "不存在此翻译：" + resourceKey, vscode.DiagnosticSeverity.Error);
                    diagnostic.source = this.diagnosticName;
                    diagnostic.code = resourceKey;
                    diagnostics.push(diagnostic);
                }
            }
            this.collection.set(doc.uri, diagnostics);
        }
        static addLocalize(doc: vscode.TextDocument, key: string){
            let resourceData = LocalizeResourceProvider.getLanguagePack(doc);
            if(!resourceData) { return; }
            resourceData[key] = key;
            LocalizeResourceProvider.saveLanguagePack(resourceData);
        }
        /**
         * 获取指定 html 字符串中注释 range 列表
         * @param text html 字符串
         */
        getHtmlCommentRanges(text: string, doc: vscode.TextDocument): vscode.Range[] {
            let ranges: vscode.Range[] = [];
            const commentStart = "<!--";
            const commentEnd = "-->";
            let pos1, pos2 = 0;
            while((pos1 = text.indexOf(commentStart, pos2)) !== -1) {
                pos2 = text.indexOf(commentEnd, pos1);
                if(pos2 !== -1) {
                    pos2 += commentEnd.length;
                    ranges.push(new vscode.Range(doc.positionAt(pos1), doc.positionAt(pos2)));
                }
            }
            return ranges;
        }
        dispose() {
            while(this.cache.length > 0) {
                let resource = this.cache.pop();
                resource && resource.dispose();
            }
        }
    }
}


export function activate(context: vscode.ExtensionContext) {
    if(!vscode.extensions.getExtension("dbaeumer.vscode-eslint")) {
        vscode.window.showInformationMessage("请安装 ESLint 扩展！");
    }
    let config = vscode.workspace.getConfiguration("vdife");
    if(!checkConfigrations(config)) { return; }
    new diagnostics.DeprecatedAPIProvider(context);
    let localizeProvider = new diagnostics.LocalizeProvider(context);
    // 手动执行 "同步 localize" 命令时
    context.subscriptions.push(vscode.commands.registerTextEditorCommand("vdife.syncLocalize", (textEditor, edit) => {
        if(textEditor.document.languageId !== "html") {
            return;
        }
        let doc = textEditor.document;
        let resourceData = LocalizeResourceProvider.getLanguagePack(doc);
        if(!resourceData) { return; }
        let text = doc.getText();
        let hasNewLocalize = false;
        let newText = text.replace(diagnostics.localizeRegExp, function(m, key){
            if(resourceData && !resourceData.hasOwnProperty(key)) {
                hasNewLocalize = true;
                resourceData[key] = key;
            }
            return m.indexOf("data-") === 0 ? m.substring(5) : m;
        });
        if(hasNewLocalize) {
            let allRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
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
    context.subscriptions.push(vscode.commands.registerCommand("vdife.fixDeprecated", function(doc: vscode.TextDocument, range: vscode.Range){
        let editor = vscode.window.activeTextEditor;
        if(!editor) { return; }
        if(editor.document !== doc) { return; }
        diagnostics.DeprecatedAPIProvider.fix(editor, range);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("vdife.addLocalize", function(doc: vscode.TextDocument, key: string){
        diagnostics.LocalizeProvider.addLocalize(doc, key);
        localizeProvider.updateDiagnostics(doc);
    }));
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