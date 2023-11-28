---
related:
- "[[CPU]]"
created_at: "21-10-2022 15:18"
---


# Aufgaben
---
- steuert den Ablauf der Befehlsverarbeitung
- sendet und empfängt Steuersignale über den Steuerbus
- kommuniziert so mit den Funktionseinheiten

# Komponente
---
## Register
Spezielle Speicherbereiche im Prozessor mit besonders schnellen Zugriffszeiten. 

| Register                  | Use                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Accumulator               | stores data taken from memory                                                                                                    |
| Memory Address Registers  | stores address of the location to be accessed from memory ([[RAM]]) (MAR and MDR facilitate the communication of CPU and memory) |
| Memory Data Registers     | contains data to be written into or to be read out from the addressed location                                                   |
| General Purpose Registers | stores temporary data, can be accessed by assembly                                                                               |
| Program Counter           | stores memory address of the next instruction to be fetched                                                                      |
| Instruction Register      | holds instruction which is just about to be executed (fetched from PC)                                                           |
| Condition Code Register   | contains different flags indicating the status of any operation (Carry, Overflow, Zero)                                          |

## Befehlsdecodierer
- Übersetzt die Maschinenbefehle in einzelne Mikro-Instruktionen

## Operationssteuerung
- steuert die internen Abläufe in der CPU
- lädt Befehle und Daten
- Verarbeitet Anweisungen vom Befehlscodierer
- setzt Steuersignale
- Steuert den Transfer von Daten (Register <==> Speicher)
- erhöht bzw. setzt den Befehlsregister
- Aktualisiert das Status-Register

## Taktgeber
- bestimmt die Operationsgeschwindigkeit und synchronisiert die Funktionseinheiten