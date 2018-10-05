import {spawn} from "child_process";

export function getBranch(repo:string) {
    return new Promise<string|undefined>(function(resolve, reject){
        let proc = spawn("git", ["branch"], {
            cwd: repo
        });
        let outbuf: Buffer[] = [];
        let errbuf: Buffer[] = [];
        proc.on("close", function(code){
            if(code === 0) {
                resolve(Buffer.concat(outbuf).toString());
            } else {
                reject(new Error(Buffer.concat(errbuf).toString()));
            }
        });
        proc.stdout.on("data", (b: Buffer) => outbuf.push(b));
        proc.stderr.on("data", (b: Buffer) => errbuf.push(b));
        proc.on("error", reject);
    }).then(function(output){
        let currentBranch: string = "";
        output && output.split(/\r?\n/g).forEach(function(branch){
            if(branch.indexOf("*") === 0) {
                currentBranch = branch.substring(1).trim();
            }
        });
        if(!currentBranch) {
            throw new Error(`can't read git branch for ${repo}`);
        }
        return currentBranch;
    });
};

/**
 * 验证 ngconsole, ngconsole_resources 仓库名是否一致。
 * ngconsole 命名规则：{version}-dev|{version}-OEM-{name}
 * ngconsole_resources 命名规则：{version}
 * @param ngconsoleBranch ngconsole 仓库分支名
 * @param resourceBranch ngconsole_resources 仓库分支名
 */
export function isBranchMatch(ngconsoleBranch: string, resourceBranch: string) {
    let parts = ngconsoleBranch.split("-");
    if(parts.length === 2 && parts[1] === "dev") {
        return parts[0] === resourceBranch;
    }
    if(parts.length === 3 && parts[1] === "OEM") {
        return parts[0] === resourceBranch;
    }
    return false;
}