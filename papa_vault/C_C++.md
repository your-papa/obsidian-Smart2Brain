---
related:
  - "[[Programming]]"
  - "[[HWR]]"
  - "[[4. Semester]]"
created_at: 16-12-2022 11:26
tags: []
prof: Peter Puschmann
type: PL
---
# Prof Präsi
---
- [[Einführung_CPP.pdf]]
- [[02_Grundlagen_Konstruktoren.pdf]]
- [[Namespaces_Operatoren_Konvertierung.pdf]]
- [[Const_Static_Exceptions.pdf]]
- [[Vererbung.pdf]]
- [[Polymorphie_Typcasting.pdf]]
- [[Mehrfachvererbung_Templates.pdf]]
- [[Standardlibrary.pdf]]
- [[Cpp11.pdf]]

# LSP
---
Mason: install clangd if its not already installed

# Setup Bitcoin Code env
---
in bitcoin dir [](https://github.com/bitcoin/bitcoin/blob/master/doc/build-unix.md)
```bash
./autogen.sh && ./configure CXX=clang++ CC=clang
```

Compilation Database required for clangd: on this [topic](https://sarcasm.github.io/notes/dev/compilation-database.html)
install bear (because build tool is not cmake) and then
```bash
make clean; bear -- make -j15
```