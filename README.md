# vdife

给公司前端写的 ngconsole 项目多语言资源辅助工具。

## 功能

### localize 指令相关：

* 编辑 ngconsole 仓库中的 html 时，扩展可以执行 `同步 localize` 命令
* 编辑 ngconsole 仓库中的 html 时，扩展可以执行 `新增/修改 localize` 命令
* 编辑 ngconsole 仓库中的 html 时，扩展可以高亮显示[*不*]存在的 localize 属性

### 弃用 API 提醒：

* 编辑 js/vdi, js/voi 下面的 js 文件时，可以高亮 `$$$I18N`, `$$$MSG` 代码调用
* 编辑 js/vdi, js/voi 下面的 js 文件时，可以高亮 `$.bigBox(...)` 代码调用
* ~~编辑 ngconsole 仓库中的 html 时，扩展可以高亮 3 层无用嵌套~~


## 设置项

* `vdife.ngconsole`: 指定 ngconsole 仓库的本地路径
* `vdife.ngconsole_resources`: 指定 ngconsole_resources 仓库的本地路径

