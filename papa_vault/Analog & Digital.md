---
related:
- "[[Digitaltechnik]]"
created_at: "29-10-2022 14:31"
---


# Prof Präsentation

[1T_DT_Analog_Digital_compressed.pdf](1T_DT_Analog_Digital_compressed.pdf)

# Signale - Analog und Digital

![Untitled](Files/Untitled%2077.png)

![Untitled](Untitled%201%2013.png)

![Untitled](Untitled%202%2012.png)

💡 Diskretisierung in eine endliche Anzahl zugelassener Amplitudenwerte, auch **Quantisierung** genannt.

# Verarbeitung
---
![Untitled](Untitled%203%2010.png)

## Nachteile Analog
- Fehleranfälligkeit
- Übertragbar nur über bestimmte Distanz
- schlecht Speicherbar

# Codierung - Digitalsignal als ASCII-Text
---
![Untitled](Untitled%204%208.png)

# Analog → Digital
---
Ein Analog-Digital-Wandler konvertiert ein analoges Eingangssignal in ein digitales Datenformat.
Schritte: 
1. Abtasten -> Diskretisierung
2. Halten -> Abtast-Halte-Glied
3. Zuordnen -> Quantisierung

![Untitled](Untitled%205%208.png)

![Untitled](Untitled%206%207.png)

## Beispiel
![Untitled](Untitled%207%206.png)

## Abtasttheorem
💡 Eine auf $f_g$ bandbegrenzte Signalfunktion $s(t)$ wird vollständig bestimmt durch ihre zeitdiskreten und äquidistanten Ordinaten $s_a(t)$ im zeitlichen Abstand von $T=T_{abt}\leq\frac{1}{2f_g}$.

## Beispiel: zu langsame Messung
![Untitled](Untitled%208%206.png)

![Untitled](Untitled%209%206.png)

![Untitled](Untitled%2010%206.png)

## Sample and Hold
![Untitled](Untitled%2011%206.png)

## Analog-Digital-Umsetzer Funktionsweise
![Untitled](Untitled%2012%206.png)

💡 Sei $Q$ die Quantisierungsintervallbreite und $U_{max}$ der im Datenblatt angegebene Aussteuerbereich.

$$
Q=\frac{U_{max}}{2^n}
$$

## Beispiel
![Untitled](Untitled%2013%205.png)

## Quantisierungsfehler
![Untitled](Untitled%2014%205.png)
![Untitled](Untitled%2015%205.png)
![Untitled](Untitled%2016%205.png)

## Beispiel
![Untitled](Untitled%2017%205.png)

![Untitled](Untitled%2018%205.png)

![Untitled](Untitled%2019%205.png)

## Charakteristische Merkmale
![Untitled](Untitled%2020%205.png)

## Wandlungsverfahren
Parallele Verfahren -> direkte Umsetzung:
- Flash ADU
- Pipeline ADU
Serielle Verfahren -> rückgekoppelte Umsetzer
- Wägeverfahren ADU (Sukzessive Approximation)
- Delta-Sigma
Zählverfahren -> integrierender Umsetzer
- Dual-Slope
- (Single-Slope)

### Paralleler ADU
![Untitled](Untitled%2021%205.png)

- Flash-Verfahren ist schnell.
- Wandlungszeit in ns
- Hoher Schaltungsaufwand
- Es sind n Widerstände und 2n -1 OPs erforderlich.
- 12-Bit Auflösung
Einsatz: Videotechnik

#### Spannungsteiler
![Untitled](Untitled%2022%205.png)

#### Komperator
![Untitled](Untitled%2023%205.png)

#### Beispiel
![Untitled](Untitled%2024%205.png)

### Pipeline-Analog-Digital
![Untitled](Untitled%2025%205.png)

### Wägeverfahren ADU

![Untitled](Untitled%2026%204.png)

![Untitled](Untitled%2027%204.png)

![Untitled](Untitled%2028%204.png)

![Untitled](Untitled%2029%203.png)

![Untitled](Untitled%2030%203.png)

#### Beispiel

![Untitled](Untitled%2031%203.png)

![Untitled](Untitled%2032%203.png)

#### AD-Wandler des ATmega328
![Untitled](Untitled%2033%203.png)

### Sigma-Delta-Umsetzer
![Untitled](Untitled%2034%203.png)

![Untitled](Untitled%2035%203.png)

#### Beispiel
![Untitled](Untitled%2036%203.png)

![Untitled](Untitled%2037%203.png)

#### Schaltplan
![Untitled](Untitled%2038%203.png)

### Dual-Slope-Verfahren
![Untitled](Untitled%2039%203.png)

![Untitled](Untitled%2040%202.png)

![Untitled](Untitled%2041%202.png)

![Untitled](Untitled%2042%202.png)

![Untitled](Untitled%2043%202.png)

#### Schaltplan
![Untitled](Untitled%2044%202.png)

## Übersicht
![Untitled](Untitled%2045%201.png)

![Untitled](Untitled%2046%201.png)

![Untitled](Untitled%2047%201.png)

## Auflösung und Abtastrate
![Untitled](Untitled%2048%201.png)

![Untitled](Untitled%2049%201.png)

# Digital → Analog
---
Ein Digital-Analog-Wandler konvertiert ein digitales Datenformat in ein analoges Eingangssignal.
Schritte:
1. Zuordnen
2. Halten
3. Zwischenwertberechnung -> Interpolation

![Untitled](Untitled%2050%201.png)

**Verfahren:**
![Untitled](Untitled%2051%201.png)
Paralleles Verfahren:
- Spannungsteiler-Demultiplexer
- R-Reihenschaltung
Wägeverfahren:
- R2R-Netzwerk
- Gewichtete Ströme
Zählverfahren
- PWM

## DAU - Summation der gewichteten Ströme
![Untitled](Untitled%2052%201.png)
Bild unten ist ein invertierender Verstärker

## Thevenin-Theorem
![Untitled](Untitled%2053%201.png)

## Beispiel
![Untitled](Untitled%2054%201.png)

![Untitled](Untitled%2055%201.png)

## Überlagerungsprinzip
![Untitled](Untitled%2056%201.png)

# Teil 2
[2T_DT_Analog_Digital_Teil2_14042022.pdf](2T_DT_Analog_Digital_Teil2_14042022.pdf)

## Zener Diode
![Untitled](Untitled%2057%201.png)