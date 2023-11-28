---
related:
  - "[[HWR]]"
  - "[[3. Semester]]"
created_at: 15-10-2022 23:14
tags: []
prof: Patrick Buck
---


# Prof Präsentation
---
[[EmbeddedSystems-2022-Skript-komplett.pdf]]

# Definition
---
Im Gegensatz zum Personal Computer, der für die Interaktion mit dem Anwender optimiert und vorgesehen ist, befinden sich Eingebettete Systeme üblicherweise in einem technischen Kontext mit der Umgebung. Wohingegen Personal Computer in der Regel mit einem Monitor und einer Tastatur ausgestattet sind, interagieren Eingebettete Systeme mit der Umwelt und ihrem Umfeld. Eingebettete Systeme sind in ihrer Komposition einem bestimmten Anwendungszweck angepasst und zeichnen sich durch diverse Charakteristiken aus.

# Charakteristiken
---
## Verlässlichkeit
- Zuverlässigkeit
- Wartbarkeit
- Verfügbarkeit
- Sicherheit
- Integrität

## Effizienz
- Energie
- Codegröße
- Laufzeit
- Gewicht
- Preis

## Spezialisierung
- Erfüllen eine bestimmte Anwendung
- Mehrere Programme auf einem System senken Verlässlichkeit und erfordern mehr Ressourcen

## Aktiv und Reaktiv
- Aktuatoren -> nehmen Einfluss auf Umwelt
- Sensoren -> sammeln Informationen über Umgebung
Meist wird Reaktiv gehandelt. Auf Sensordaten werden bestimmte Aktionen durchgeführt.

# Mooresches Gesetz
---
![[Pasted image 20221017162042.png]]
The number of transistors on microchips doubles every two years.

# Relevante Programmiersprachen
---
## Maschinensprache
![[Pasted image 20221030131131.png]]
Sprache die direkt vom Prozessor ausführbar ist (nicht zu verwechseln mit Assemblersprache).
Befehle und Daten werden hier bereits in Bitcode geschrieben, welche im Steuerwerk den zugehörigen Mikrocode-Sequenzen zugeordnet wird.
Programmiersprache der ersten Generation.

**Mikrocode:**
Der Mikrocode ist der Binärcode eines Mikrobefehls oder einer Mikrobefehlssequenz eines Mikroprogramms.

**Operationscode:**
Eine Zahl, welche die Nummer eines Maschinenbefehls für einen bestimmten Prozessortyp angibt. Die Summer aller Opcodes bilden den Befehlssatz eines Prozessors.

## [[Assemblersprache]]

## [[VHDL - Hardware Description Language]]

# Architektur
---
## Mikroprozessor
---
Wendet meist die [[Computer Architekturen#Harvard|Harvard Architektur]] an.

### [[Steuerwerk]]
### [[Rechenwerk]]
### Interrupts
Ein Signal, welches die derzeitige Programmausführung unterbricht um auf ein Ereignis zeitkritisch mit einer kurzen Routine (ISR) zu reagieren.
1. software oder hardware-seitige Unterbrechungsanforderung
2. Informationen vom derzeitigen Prozess (zB PC, aber auch Programm spezifische Variablen) werden zwischengespeichert
3. Auszuführende Routine kann von anderen Privilegierten Routinen unterbrochen werden
4. Die Zuordnung zwischen Interrupt (Unterbrechungsanforderung) und Interrupt Service Routine (Unterbrechungsroutine) wird in der Interrupt-Vektor-Tabelle (IVT) gespeichert
![[image 13.png]]

### Bussysteme
Verbindung zum Informationsaustausch zwischen von mindestens zwei Komponenten.
**Arten**:
- Parallele Datenübertragung (gleichzeitig, mehrere Leitungen)
- Serielle Datenübertragung (nacheinander, eine Leitung)
**Übertragungsmodi**:
- Simplex (Richtungsbetrieb) - eine Richtung
- Halb-Duplex (Wechselbetrieb): beide Richtungen, nicht gleichzeitig
- (Voll-)Duplex (Wechselbetrieb):  beide Richtungen gleichzeitig

**U(S)ART** - Universal (Synchronous) Asynchronous Receiver Transmitter
<iframe width="560" height="315" src="https://www.youtube.com/embed/t-K1jHKactw" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

**SPI** - Serial Peripheral Interface
<iframe width="560" height="315" src="https://www.youtube.com/embed/k3v_i1YmCo4" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

**I²C** - Inter-Integrated Circuit
<iframe width="560" height="315" src="https://www.youtube.com/embed/3wlITceWQBw" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

## Speicher
---
Speicherhierarchie
![[image (1).png]]

### [[RAM]] - Random Access Memory

### ROM - Read Only Memory
- Masken-ROM (Festwertspeicher)
- Programmable ROM (Einmal Programmierbar)
- Erasable PROM (Rücksetzbar mit UV-Licht + Mehrfach beschreibbar)
- Electrically EPROM
- **Flash-EEPROM** (Moderne Variante: Daten werden Blockweise gelöscht/beschrieben)

## Peripherien
---
### I/O-Pins
GPIO (General Purpose Input/Ouput)
Kontakt an einem integrierten Schaltkreis, der durch logische Programmierung als Eingang oder als Ausgang bestimmt werden kann. 
->mehrfach belegte Funktionalität
Meist mit Pull Ups/Downs realisiert (Um immer definierte Spannung zu haben)

### [[Analog & Digital#Analog → Digital|ADC]] - [[Analog & Digital#Digital → Analog|DAC]]

### Timer
- Verbunden mit Systemtakt

Komponenten:
- **Vorkonfigurierte ALU**: Im Prinzip ist die Zähleinheit eines Timer eine vorkonfigurierte ALU, die den Zählwert um den definierten Wert inkrementiert oder dekrementiert.
- **Zählregister**
- **Vergleichsregister**
- **Prescaler** (Vorteiler): Mit dem Vorteiler wird die Zählfrequenz des Timers angepasst
- **Konfigurationsregister**: Einstellungen des Timers

**Aufgaben:**
1. Zählen von Ereignissen Der Impuls des eingetretenen Ereignisses wird dem Timer als Taktsignal zugeführt
2. Periodischer Taktgenerator Erreicht der Zählwert den Vergleichswert, wird ein verwertbares Ereignis erzeugt und der Zählwert zurückgesetzt.
3. Messen von Zeitabständen Zum Zeitpunkt des Ereignisses wird das Register des Zählwerts abgefragt und ausgewertet
1-3:
![[image (21) 1.png]]

### Echtzeituhr
- Aktuelle Uhrzeit/Datum
- In der Regel unabhängige Stromversorgung

Komponenten:
- Timer
- Schwingquarz (Taktgeber)
- Unabhängige Energieversorgung

### [[Embedded Systems#Bussysteme|Bussysteme]]

### (Spannungsteiler & Paralleler Widerstand)
![[image (2).png]]

# Software-Eigenschaften
---
### Zeiten und Schranken
- **Antwortzeit** (Latenz, Reaktionszeit): Zeit zwischen eintreten eines Ereignis der darauffolgenden Antwort
- **Zeitkomplexität**
- **Ausführungszeit** (Laufzeit): Wird beeinflusst von der Programmlogik, der Datenmenge und Datengröße der zu verarbeiteten Daten, des Compilers und der Architektur und Taktfrequenz des Systems.
	- Durchschnittliche Ausführungszeit
	- Minimale Ausführungszeit
	- Maximale Ausführungszeit

### Realtime
> Unter Echtzeit versteht man den Betrieb eines Rechensystems, bei dem Programme zur Verarbeitung anfallender Daten ständig betriebsbereit sind, derart, dass die Verarbeitungsergebnisse innerhalb einer vorgegebenen Zeitspanne verfügbar sind. Die Daten können je nach Anwendungsfall nach einer zeitlich zufälligen Verteilung oder zu vorherbestimmten Zeitpunkten anfallen.“ 
> -- <cite>DIN 44300 (Informationsverarbeitung), Teil 9 (Verarbeitungsabläufe)</cite>

### [[Scheduling]]
