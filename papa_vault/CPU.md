---
related:
- "[[Struktur von Rechenanlagen]]"
created_at: "21-10-2022 16:42"
---


# Komponente
---
## [[Rechenwerk]]
## [[Steuerwerk]]
## MMU 
Memory Management Unit [[Struktur von Rechenanlagen#Virtuelle Speicherverwaltung|Speicherverwaltung]]

# Pipelining
---
## Problems
- Manche Befehl brauchen Ergebnis vom letzten Befehl (gelöst auf compiler Ebene)
- Pre-fetchen, aber welche Adresse?

## Solution - Branch Prediction
Lokalitätsprinzip

# CISC vs RISC
---
## Complex Instruction Set Computer
- Großer Befehlsvorrat
- Teurer
- Komplexe Instruktionen Einprogrammiert in Steuerwerk → langsamer weil Memory-to-Memory
- Weniger Aufwand in der Software (Benötigt weniger [[RAM]])
- Used on x86-64bit Processors

## Reduced Instruction Set Computer
- Kleiner Befehlsvorrat
- Billiger
- Viel schneller - Eine Instruktion ein Clock cycle
- Mehr Aufwand in der Software (Benötigt mehr [[RAM]])
- Used in ARM (Smartphones)
