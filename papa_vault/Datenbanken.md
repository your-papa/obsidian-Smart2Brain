---
related:
  - "[[HWR]]"
  - "[[1. Semester]]"
created_at: 29-10-2022 15:28
prof: Zimmermann
tags: []
---


# Prof Presentation
---
[DBE.pdf](DBE.pdf)

# Einführung

## Definitionen

### Daten und Datenbank

![Untitled](Untitled%20101.png)

### **Charakteristik der Informationen im Unternehmen**

- Informationen bilden Entscheidungsgrundlagen
- Informationen können aus unterschiedlichen Quellen stammen
- Qualität der Information ist von Verfügbarkeit, Korrektheit und Vollständigkeit anhängig
- Erhebung, Speichern und Verarbeiten der Daten erzeugt Aufwände
- Aufgabengebiete im Unternehmen sind durch Informationsbeziehungen miteinander verknüpft

### **Verschiedene Aspekte des Datenmanagements**

- Architektur (Datenmodellierung)
- Datentechnik (Hardware, Installation, Reorganisation, Sicherung)
- Administration und Datennutzung

### **Anforderungen an Datenverwaltung**

- Zentrale Verwaltung der Daten
- Vermeidung oder Einschränkung der Redundanzen
- Vermeidung von Inkonsistenzen
- Gemeinsame Nutzung der Daten durch verschiedene Anwendungen
- Datenschutz und Datensicherung
- Datenintegrität
- Datenunabhängigkeit von Anwendungen

## Modellierung

### Modell

![Untitled](Untitled%201%2027.png)

### Kriterien nach Heinrich Hertz

![Untitled](Untitled%202%2026.png)

Zur erstellung von Modellen gibt es Modellierungssprachen (ERM, UML...)

## Datenhaltung Anforderungen

- Verarbeitung und Auswertung
- Sicherheit und Integrität
- Präsentation und Statistik
- Sicherung, Wiederherstellung und Replikation
- Import und Export

**2 Formen → keine Anderen!**

- Herkömliche Form - Dateien, Dateisysteme
- Datenbanken

## Datenverwaltung

### Dateien

- In Anwendung integriert
- Vorteile/Anwendungen
    - sehr kleine, nicht kommerzielle Anwendungen
    - systemnahe Anwendungen
    - verschiedene Testumgebungen
    - grobe konzeptuelle Entwicklungen
- Nachteile
    
    → enormer Aufwand in Software-Entwicklung
    
    → Datenaustausch zwischen Anwendungen kaum möglich
    
    → Standards und Normen nur geringe Verwendung
    

### Datenbank

- Datenmanagement + Daten
- DBMS: Speicherung, Aufruf, Änderung, Sortieren, Sicherung der Daten
- Vorteile:
    
    → Funktionen nur Aufgerufen und nicht neu geschrieben
    
    → Standardisierung mit industriellen Normen → geringere Kosten
    
    → flexible Verarbeitung und Darstellung der Daten
    
    → Vermeidung von unnötigen Redundanzen, Inkonsistenzen, Datenverlust
    
    → konkretere Zugriffskontrolle
    
    → Mehrnutzerkontrolle
    
    → Hohe Verfügbarkeit
    

# Mengenlehre

Operationen wie Kartesisches Produkt, Schnittmenge, Vereinigung

Zahlenmengen

siehe [Diskrete Mathematik](https://www.notion.so/Mengen-Relationen-Funktionen-Ringe-433a4c9f04f64cdeb32d57578ff03c2b)

# Konzeptueller Entwurf - ERM (Entity Relationship Model)

## Peter Chen Notation

![image 8.png](image%208.png)

## Entität

![Untitled](Untitled%203%2023.png)

## Attribute

![Untitled](Untitled%204%2021.png)

![Untitled](Untitled%205%2020.png)

## Beziehung

![Untitled](Untitled%206%2018.png)

## Rekursive Beziehung

![image (2).png](image_(2)%206.png)

## Schlüssel

![Untitled](Untitled%207%2016.png)

### Beispiel

Universitätsschema

![image (3).png](image_(3)%206.png)

## Funktionalitäten

![Untitled](Untitled%208%2016.png)

### N-äre Beziehungen

![image (4).png](image_(4)%205.png)

Wird gespaltet

## Konzepte

![Untitled](Untitled%209%2016.png)

### Aggregation - Hat einen

![image (5).png](image_(5)%205.png)

### Komposition

![image (6).png](image_(6)%205.png)

### Generalisierung

![Untitled](Untitled%2010%2016.png)

Beispiel:

![Untitled](Untitled%2011%2016.png)

# Logischer Entwurf

![image (7).png](image_(7)%206.png)

## Vorteile Relational Darstellung

![image (8).png](image_(8)%205.png)

## Die 9 Codd’schen Anforderungen für Datenbanksysteme

![image (9).png](image_(9)%205.png)

## Konvertierung eines ERM in eine relationale Darstellung

![image (10).png](image_(10)%205.png)

![image (11).png](image_(11)%205.png)

# SQL

## Spracharten SQL

![Untitled](Untitled%2012%2016.png)

## Datentypen

![Untitled](Untitled%2013%2014.png)

![Untitled](Untitled%2014%2014.png)

![Untitled](Untitled%2015%2013.png)

## Einfache Befehle

### Tabelle anlegen/löschen

![Untitled](Untitled%2016%2013.png)

### Einfügen

![Untitled](Untitled%2017%2012.png)

### Löschen/Ändern

![Untitled](Untitled%2018%2011.png)

### Abfrage

![Untitled](Untitled%2019%2011.png)

## Erweiterungen

![Untitled](Untitled%2020%2011.png)

![Untitled](Untitled%2021%2010.png)

![Untitled](Untitled%2022%2010.png)

## Anfrage über mehrere Tabellen (Join)

![Untitled](Untitled%2023%2010.png)

## Aggregatfuntkionen

![Untitled](Untitled%2024%2010.png)

### GROUP BY

![Untitled](Untitled%2025%2010.png)

![Untitled](Untitled%2026%209.png)

### HAVING

![Untitled](Untitled%2027%209.png)

![Untitled](Untitled%2028%209.png)