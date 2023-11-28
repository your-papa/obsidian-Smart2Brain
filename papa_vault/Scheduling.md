---
related:
- "[[Embedded Systems]]"
created_at: "17-10-2022 17:24"
---


# Definition
---
Übersetzt: Zeitplanung/Ablaufplanung
Scheduling beschreibt die Zuteilung verfügbarer Ressourcen zu anstehenden Aufgaben. Dazu wird eine Arbitrationslogik verwendet, welche die Priorität dieser bestimmt.

Eine sinnvolle und gerechte Zuteilung der Ressourcen entsprechend der erforderlichen Ausführungszeit von Aufgaben ist eines der entscheidenden Hauptprobleme bei Echtzeitsystemen und daher eine große Herausforderung. ([[NP-Problem]])

# Tasks
---
Eine Task (deutsch: Aufgabe) ist eine Ausführungseinheit oder eine Arbeitseinheit eines (Teil-)Programms. Häufig werden hierfür auch die Begriffe Prozess oder Thread verwendet. Aus Sicht des Betriebssystems werden Tasks als anstehende Aufgabe abgearbeitet und zählen im Anschluss als erledigt.

## Periodische Tasks
- Tasks, die alle p Zeiteinheiten ausgeführt werden müssen, heißen periodisch (p heißt ihre Periode)
- Jede Ausführung einer periodischen Task heißt Job

## Aperiodische Tasks
- Tasks, die nicht periodisch sind, heißen aperiodisch
- Diese Tasks werden alle [ p ± Δ ] Zeiteinheiten ausgeführt

## Sporadische Tasks
- Tasks, die den Prozessor zu unvorhersehbaren Zeiten anfordern, heißen sporadisch
- Es wird vorausgesetzt, dass zwischen den Zeitpunkten, zu denen der Prozessor angefordert wird, eine minimale Zeit vergeht

# Präemptives und Nicht-Präemptives Scheduling
---
## Präemptiv - Unterbrechend 
Bei präemptivem Scheduling wird die Ausführung einer Task vom Scheduler unterbrochen bzw. angehalten, um eine andere Task auszuführen. Die Ausführung der unterbrochenen Task wird nach der beendeten priorisierten Task fortgesetzt.
- **Vorteil**: zu jeder Zeit kann die Ausführung von wichtigen und zeitkritischen Aufgaben berücksichtigt werden. 
- **Nachteil**: Tasks können sich nicht an ihrer eigenen Ausführungszeit orientieren. Je nach Zeitpunkt der Unterbrechung arbeiten fortgesetzte Tasks unter Umständen mit veralteten Werten.

## Nicht-Präemptiv -> kooperativ
Die Ausführung einer begonnen Task wird nicht unterbrochen und wird abgeschlossen. 
- **Vorteil**: Begonnene Tasks können mit ihrer Ausführungszeit rechnen.
- **Nachteil**: Bei Task mit langen Ausführungszeiten kann die Reaktion auf notwendige oder zeitkritische Ereignisse erst sehr spät oder zu spät erfolgen.

# Statisches und Dynamisches Scheduling
---
## Statisch
Bei statischer Ablaufplanung wird der Zeitablaufplan wird zur Entwurfszeit des Systems festgelegt. Startzeiten werden in abstrahierenden Listen bzw. Tabellen eingetragen.
- **Vorteil**: Jeder Zeitpunkt des rechnenden Systems ist vorherbestimmt. Zu jedem Zeitpunkt kann die nötige Rechenzeit gewährleistet werden.
- **Nachteil**: Die Einteilung der Tasks muss sehr aufwendig und zeitintensiv vorgenommen werden, häufig erzielt man trotzdem nur eine schlechte Ausnutzung der Rechenzeit.

## Dynamisch
Bei dynamischer Ablaufplanung wird die Ablaufplanung zur Laufzeit durchgeführt. Die Planung wird anhand der vorliegenden veränderlichen Informationen aus den Jobs bzw. Tasks sowie der Systemleistung vorgenommen.
- der Bedarf an Ressourcen
- die Datenabhängigkeit
- die Ausführungszeit
- **Vorteil**: Die Einteilung der Tasks muss nicht aufwendig während des Entwurfs vorgenommen werden.
- **Nachteil**: Die Ausführung und der Ausführungszeitraum der Tasks ist weder gewährleistet noch vorgesehen. 

# Strategien
---
- First-Come First-Serve [[EmbeddedSystems-2022-Skript-komplett.pdf#page=70&selection=4,0,4,4|FCFS]]
- Round-Robin [[EmbeddedSystems-2022-Skript-komplett.pdf#page=71&selection=0,8,2,5|RR]]
- Shortest-Processing-Time [[EmbeddedSystems-2022-Skript-komplett.pdf#page=72&selection=2,0,2,3|SPT]]
- Shortest-Remaining-Time
- Earliest-Due-Date
- Earliest-Deadline-First
- Rate Monotonic Scheduling
- Deadline Monotonic Scheduling
## Beispiel - EDF
![[Pasted image 20221111112113.png]]

Auslastung:
![[Pasted image 20221111112207.png]]