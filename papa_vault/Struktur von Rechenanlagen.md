---
related:
  - "[[HWR]]"
  - "[[3. Semester]]"
created_at: 15-10-2022 23:17
tags: []
prof: Klaus Thomas
---


# [[CPU]]
---
- [[CPU Präsentation.pdf]]
- [[Mikroprogramm.pdf]]

# [[Betriebssysteme]]
---
- [[Betriebssystem Präsentation HWR 1.pdf]]
OS erleichtert und schützt Ressourcenzugriff im Kernel Mode durch Systemcalls (TRAPs) im User Mode.

TRAP - set Systembit to execute Kernel functions
- Überprüfung d. bereitgestellten Parameter (ggflls Ausführung des Ressourcenzugriff)
- Bereitstellung von Rückgabe Parameter (ggflls Fehlercode)
- reset Systembit
- Überprüfung der Rückgabeparameter (ggfls Fehlerbehandlung)

## Multitasking
---
- Multiprocessing - Prozesse müssen isoliert sein, Kernel vom User mode schützen
- Multithreading - Unter Prozess, teilen sich Address space, gemeinsamer Zugriff (Problem: Race Conditions)
Prozess hat 3 States: Ready, Running, Blocking
![[Pasted image 20221105145203.png#invert]]

# Dateisystem
---
- [[Dateisystem.pdf]]
- [[inode.pdf]]
## Journaling
Transaktionen (jeder kleine Schritt) werden mitgeschrieben und abgehakt wenn erledigt
-> Konsistente Zustände wiederherstellen

Beim nächsten Boot wird geschaut ob es Transaktionen gibt welche noch nicht komplett ausgeführt wurden (nicht abgehakt) und dann abgearbeitet oder es wird rück abgewickelt.

## Fragmentierung
Eine Datei passt nicht in Flickenteppich im Speicher
-> **Aufteilen der Datei in Blöcke** (Cluster, festgelegt im OS)
Verschnitt im durchschnitt hälfte eines Blocks
Umso größer der Block desto schneller der Zugriff und Verschnitt.

## Arten
- NTFS
- Ext4
- Fat32

# Arbeitsspeicher - [[RAM]]
---
- [[Hauptspeicher.pdf]]

# Virtuelle Speicherverwaltung
---
- [[Paging_virt2phys.pdf]]
- [[Speicherverwaltung.pdf]]
## Paging
---
- Physikalischer Speicher - Seitenrahmen
- Virtueller Adressraum - Seiten
Konversion der beiden durch Seitentabelle in der MMU (Memory Management Unit) und durch TLB im Prozessor Cache.

Was nicht in den Hauptspeicher passt wird auf die Festplatte im Swap geschrieben und kann wenn im Hauptspeicher platz frei wird eingeswapt werden.

## Segmentierung
---
### Relocation
#TODO

# Peripheriegeräte
---
- [[Peripheriegeräte.pdf]]

# [[Embedded Systems#Interrupts|Interrupt Service Routine]]
---
# [[Analog & Digital]]
---
Analog Signal kontinuierlich wird quantisiert (zeit und wert) und als Digitales Signal (001010) abgebildet. Dadurch geht Präzision verloren.

# Binäre Zahlendarstellung
---
- [[Binäre Zahlendarstellung.pptx]]
- [[Zahlenformate.pdf]]
## 1er Komplement
1. Positive Zahlen bleiben wie sie sind
2. Negative Zahlen werden invertiert
Vorteil: Einfacher zu arithmetisch zu Rechnen als nur ein Vorzeichenbit zu nutzen
Nachteil: 0 hat zwei Darstellungen (+0, -0 -> 0000, 1111)

## 2er Komplement
1. Positive Zahlen bleiben wie sie sind
2. Negative Zahlen werden invertiert
3. Negative Zahlen werden zusätzlich um 1 inkrementiert
Vorteil: 0 nur eine Darstellung: Wertebereich -8 -> 7
![[Pasted image 20221106150436.png#invert]]

## Fließkommazahlen
![[Floating Point 32Bit IEEE|900]]
