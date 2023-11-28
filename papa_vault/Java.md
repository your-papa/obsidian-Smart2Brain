---
related:
- "[[Programming]]"
created_at:  "10-11-2022 00:02"
type: PL
---


# Java
---
## LSP - Nvim-jdtls

1. install [jdtls](https://github.com/eclipse/eclipse.jdt.ls#installation) in user home directory (download zip and extract) or somewhere else (need user privileges, non root or you would get errors)
2. change path of jdtls jar (in nvim/ftplugin/java.lua) to the location you downloaded jdtls to
3. [change path of java-debug to install location](https://github.com/mfussenegger/nvim-jdtls#debugger-via-nvim-dap)

#TODO: more automatic

if error non project file you need to set -data flag (in java.lua) to workspace folder instead of specific repo