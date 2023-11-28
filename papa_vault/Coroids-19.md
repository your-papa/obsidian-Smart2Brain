---
related:
  - "[[HWR]]"
  - "[[Software Engineering]]"
  - "[[Projekt]]"
created_at: 17-10-2022 16:52
tags: Project/Done
---
![[Pasted image 20221106131649.png]]

**Dokumentationsschablone**
- Kurze Beschreibung des Ziels
- Anfoderungsquelle nennen
- Auswirkungen auf die Stakeholder beschreiben
- Einschränkungen notieren

# Projektziel
---
Wir wollen ein Retrospiel erstellen was zu simplifizierten und unterhaltenden Bildungszwecken des Immunsystems dient.

**Anforderungsquelle**
Stakeholder Grundschullehrkräfte → Kinderfreundliches UX und UI

**Auswirkungen auf die Stakeholder**
Unterstützung für spaßige Bildungsgestaltung (Funktion des Immunsystems) (+ erhöhte Unterrichtsbeteiligung)

**Einschränkungen**
geringe Hardwareanforderungen stellen (Schulcomputer)

# [[Stakeholder_Persona.pdf| Stakeholder & Persona]]

# Quellen für Anforderungen
---
Neben allen Stakeholdern:
- Spielprinzip:
	Vorgaben und Orientierung am Original Asteroids

- Design / Grafiken:
	Darstellung von Viren und Zellen im Körper - pixel art

- Story:
	Coronakontext

# [[UML]]
---
## Use-Case Diagram 
![[Pasted image 20221019085008.png]]
PS: nicht ganz korrekt

## Klassendiagram (Basic Overview)
![[Coroids-19UML.drawio (4).png]]

# Code
---
https://github.com/Leo310/Coroids-19

# Präsentation
---
![[endpraesentation (1).pptx]]
[[Presentation Title.pdf]]

## Feedback
An der Resonanz eurer Kommilitonen habt ihr sicherlich gemerkt, dass ihr ein tolles Produkt auf die Beine gestellt habt. Folgende Anmerkungen habe ich zu eurem Vortrag:
(+) Freie, abwechslungsreiche Vortragsweise
Schöne Vorstellung der Software, Unterstützung durch ein Klassendiagramm
(-) Ihr habt euren Entwicklungsprozess leider sehr knapp dargestellt. Unter dem Titel Softwareprozesse seit ihr mehr auf technische Aspekte eingegangen (was nicht den theoretischen Inhalten der VL entspricht). Später seit ihr zwar auf Scrum und seine Elemente zurückgekommen, dennoch wäre eine tiefere Betrachtung der Herausforderungen und Probleme gut gewesen.

# Issue to solve next
---
- move shop into player (image not upgraded right)
- move upgrades into player and enemies
- preformance issues
- remove velocity of gameobject class
- make exe