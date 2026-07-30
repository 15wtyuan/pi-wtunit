# pi-wtunit Meta-Package Design

## 目标

创建一个 Pi 元包 `pi-wtunit`，将用户所有配置（子包、主题、keybindings、zentui 配置）打包为一键安装的单元，方便在多台电脑间同步。

## 打包清单

| 类型 | 内容 | 来源 |
|------|------|------|
| 子包 | superpowers | git:github.com/obra/superpowers |
| 子包 | pi-subagents | git:github.com/15wtyuan/pi-subagents@session-view |
| 子包 | pi-toolbox | git:github.com/15wtyuan/pi-toolbox |
| 子包 | pi-encoding-fs | git:github.com/15wtyuan/pi-encoding-fs |
| 子包 | pi-todo | git:github.com/15wtyuan/pi-todo |
| 子包 | pi-zentui | git:github.com/lmilojevicc/pi-zentui |
| 主题 | catppuccin-mocha.json | 本地 |
| 配置 | keybindings.json | 本地 |
| 配置 | zentui.json | 本地 |

**不包含：** models.json（含 API keys）、auth.json、本地扩展 orca-*、~/.agents/skills/

## 架构

```
pi-wtunit/
├── package.json                    # 元包清单
├── extensions/
│   └── setup.ts                   # 自动注入 keybindings.json + zentui.json
├── themes/
│   └── catppuccin-mocha.json
└── skills/                        # 预留空目录，未来可添加 skills
```

## 子包管理策略

采用 npm bundledDependencies 方式：
- 子包声明在 dependencies 里，用 git URL + 可选 ref
- bundledDependencies 确保 npm install 时打平到 node_modules
- 资源通过 `node_modules/<pkg>/<extensions|skills|themes>` 引用到 pi manifest

**更新方式：** 修改元包的 package.json（升级 ref 或子包源）→ push 元包 → 新电脑 `pi install git:github.com/15wtyuan/pi-wtunit`（或已安装则 `pi update` 元包）

## 配置自动注入（setup.ts）

首次激活时自动执行：
1. 检查 `~/.pi/agent/keybindings.json` 是否存在
2. 不存在则从元包内置文件写入
3. 检查 `~/.pi/agent/zentui.json` 是否存在
4. 不存在则从元包内置文件写入
5. 写入后设置标记，后续启动跳过
6. 如果用户已有自己的配置（文件已存在），绝不覆盖

P.S. 对于 settings.json(s)：（注：若可配置则可写入）这些配置（keybindings和zentui）通过扩展自动写入至 ~/.pi/agent/ 目录。

## 安装方式

```bash
pi install git:github.com/15wtyuan/pi-wtunit
```

一键完成所有子包安装、主题加载、配置注入。

## 待确认项

- [ ] 子包的 extensions/skills/themes 路径映射需逐个确认（部分子包可能用 convention directory 而非 manifest）
- [ ] setup.ts 是否需要考虑 already-installed 场景（幂等性）
