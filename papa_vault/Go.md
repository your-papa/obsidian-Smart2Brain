---
related:
- "[[Programming]]"
created_at:  "09-11-2022 23:57"
type: PL
---

# Go workspace setup
---
1. set GOPATH in .bash_profile or:
2. after stow bash in dotfiles repo you get .bash_profile.example
	[https://github.com/Leo310/dotfiles](https://github.com/Leo310/dotfiles)
3. You can copy content of example profile to .bash_profile
4. add those 3 folders to Gopath:
	- bin
	- src
	- pkg
5. in src put you project folder an execute
```bash
go mod init <path name since src>
```

## LSP
6. should be automatically done by ray-x/go.nvim?
(6. Install gopls language server)
```bash
go install golang.org/x/tools/gopls@latest
```

## Debugger
7. install delve