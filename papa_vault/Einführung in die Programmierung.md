---
related:
  - "[[HWR]]"
  - "[[1. Semester]]"
created_at: 29-10-2022 15:31
prof: Zimmermann
tags: []
---


# Minimalrechner
---
- Prozessor
- Arbeitsspeicher
- Datenträger
- Bussystem

## Komponenten Bussystem
- Addressbus
- Datenbus
- Steuerbus

# Architektur
---
![image (40).png](image_(40).png)
![image (41).png](image_(41).png)

# Betriebssysteme
---
- Verwaltung und Verfügungstellung von physischen und logischen Ressourcen
    Ressourcen:
    - Arbeitsspeicher (physisch und logisch), Prozesse, Tasks, Threads
    - Datenträger (physisch und logisch)
    - Interne Geräte (Netzwerkkarte, Grafikkarte, Soundkarte) und Peripherie-Geräte (Drucker, Plotter...)
    - Interrupts

Treiber: Ein Programm das für direkten Datenaustausch mit Hardwarekomponenten zuständig ist. (Betriebssytem- und Gerätabhängig)

## Aufgaben
- Auftragsverwaltung (Übernahme, Steuerung, Rückgabe der
Ergebnisse, Abrechnung der Nutzung).
- Betriebsmittelverwaltung (Bereitstellung, Umgehen von
Verklemmungen).
- Hauptspeicherverwaltung (virtueller Speicher).
- Datenverwaltung (Dateien auf Speichermedien, logisches Ein- und
Ausgabesystem).
- Ein- und Ausgabesteuerung (Übertragungsleitungen, Bedienung von
Peripherie).
- Ablaufsteuerung (Prozessverwaltung, parallele Prozeduren).
- Zugriffsschutz und Ausnahmebehandlung (Sicherheit der Daten,
Zuverlässigkeit).

## Arten
#TODO

## Zwei Modelle von Betriebssystemen
- **Schichtenmodell** (Bevorzugt: Linux, Windows): jede Schicht darf nur Dienste von Benachbarten Schichten in Anspruch nehmen
    ![image (38).png](image_(38).png)
    
- **Treppenmodell** (Veraltet MS-DOS): Schichte dürfen einander in beliebiger Reihenfolge ansprechen
    ![image (39).png](image_(39).png)
    

UEFI (Unified Extensible Firmware Interface**)** simuliert altes BIOS

CMOS (mit Batterie) Speicher von Daten (Datum, Zeit, Systemkonfigurationen) für UEFI
1. UEFI startet Bootmanager
2. Bootmanager weiß Addresse vom Kernel (OS) und startet ihn

## Bestandteile
- **Kern** (Kernel):
    - Resident im Arbeitsspeicher
    - Hauptfunktionen (Datenverwaltung, Datenkommunikation, Ein- und Ausgabesteuerung, Betriebsmittelverwaltung)
- **Externe Module**: erweitert Funktionalität des Kernels
- **Befehlsinterpreter**: ermöglicht Benutzer und Anwendung, einzelne Befehle auszuführen
- **Grafische Oberfläche**: (optional)

## Keine Bestandteile
- Startprogramm (Bootloader)
- Programmiersystem (Texteditorer, Compiler/Interpreter, Bibliotheken, Testsysteme...)
- Anwendungssoftware (Packagemanager, Textverarbeitung, Editoren...)

## Eigenschaften
- 64-Bit Prozessoren (Registergröße)
- 64-Bit Arbeitsspeicher (Addressierung)
- **Stabilität** (Anwendungsprogramme sind sauber getrennt und keinen direkten Zugriff auf Hardware, Schichtenmodell)
- **Multitasking** (Pseudo, OS ruft Anwendungen nacheinander auf, "präemtives Multitasking", früher "kooperatives Multitasking")
- **Multithreading** (Anwendungen können Aufgaben parallel auf Threads laufen lassen)
- **Modul-orientierte Software-Architektur:**
    - funktionale Komponente klar voneinander getrennt
    - in Modulen und Schichten angeordnet
    - Austausch möglich ohne ganzes System ändern zu müssen
- **Fehlertoleranz** RAID verfahren
- **Skaliebarkeit**
- **Netzwerkfähigkeit**
- **Unterstützung von UEFI**: gewährleistet moderne Festplattenverwaltung, erleichter Hardwareherstllern die Entwicklung von zukunftssicheren Systemen
- **Plug-and-Play-Fähigkeit**: Eigenschaft Geräte einfach anzuschließen, Betriebssystem startet zu Beginn alle Treiber und lässt die, die eine Antwort vom Gerät (benötigt bios, basic input output system) bekommen haben im Hauptspeicher

![image (7).png](image_(7)%207.png)

**Unix** - Enterpirselösungen

nichtkommerzielle UNIX-Varianten sind BSD und Linux

![image (8).png](image_(8)%206.png)

# Prozessverwaltung
![image 9.png](image%209.png)

![image (1).png](image_(1)%205.png)

![image (2).png](image_(2)%208.png)

![image (3).png](image_(3)%207.png)

## Virtueller Speicher
![image (4).png](image_(4)%206.png)

### Vorteile
![Untitled](Untitled%20103.png)

![image (6).png](image_(6)%206.png)

![image (7).png](image_(7)%201%201.png)

# Dateisysteme
---
Zwei Arten von Dateien

- Textdateien
- binäre Dateien

(Natürlich sind alle Dateien binär kodiert)