# StewardMX — Conexión a Power Query / Power BI / SQL (Fases 4–5)

> Entregable de documentación. **No modifica la app.** Conecta Power BI / Excel-Power Query al archivo `.xlsx` que StewardMX ya exporta. Basado en la estructura REAL de las hojas (nombres ya limpios de emoji).
>
> Fuente principal: hoja **`Análisis SPSS/R`** (plana, codificada numéricamente, 1 fila por paciente) — la mesa de hechos ideal.

---

## 0. Nombres reales de hoja (tras limpieza de emoji en el .xlsx)

| Título en la app | Nombre en el .xlsx (para M/DAX) |
|---|---|
| 🔌 Análisis SPSS/R | `Análisis SPSS R` |
| 📊 Antibiograma Hospitalario | `Antibiograma Hospitalario` |
| 💉 Historial ATBs | `Historial ATBs` |
| 🧬 Aislamientos Detalle | `Aislamientos Detalle` |
| 🚨 Alertas PROA | `Alertas PROA` |
| 🧮 Bioestadística (IC95%) | `Bioestadística (IC95%)` |

> En Power Query estos nombres se referencian como `Origen{[Item="Análisis SPSS R",Kind="Sheet"]}[Data]`.

---

## FASE 4 — Power Query (M)

### 4.1 Consulta base: `fctPacientes` (tabla de hechos)

Pega esto en **Power BI → Obtener datos → Consulta en blanco → Editor avanzado** (ajusta la ruta del archivo):

```m
let
    Ruta = "C:\StewardMX\StewardMX_reporte.xlsx",  // ← cambia a tu archivo
    Origen = Excel.Workbook(File.Contents(Ruta), null, true),
    Hoja = Origen{[Item="Análisis SPSS R", Kind="Sheet"]}[Data],
    Encabezados = Table.PromoteHeaders(Hoja, [PromoteAllScalars=true]),

    // Tipado robusto: numéricos como número, texto como texto.
    // Las columnas codificadas (severity_0l_3c, aware_1a_3r, mdr, cult_taken...) son enteros.
    Tipos = Table.TransformColumnTypes(Encabezados, {
        {"id", type text}, {"age", Int64.Type}, {"sex_m", Int64.Type},
        {"weight_kg", type number}, {"service", type text}, {"bed", type text},
        {"dx", type text}, {"dx_category_code", type text}, {"dx_category_label", type text},
        {"icd10", type text}, {"icd10_desc", type text},
        {"severity_0l_3c", Int64.Type}, {"icu", Int64.Type},
        {"atb", type text}, {"atb_doi", Int64.Type}, {"aware_1a_3r", Int64.Type},
        {"restricted", Int64.Type}, {"indication", Int64.Type}, {"adequacy", type text},
        {"cult_taken", Int64.Type}, {"cult_positive", Int64.Type},
        {"organism", type text}, {"phenotype", type text},
        {"mdr", Int64.Type}, {"blee", Int64.Type}, {"cre", Int64.Type},
        {"mrsa", Int64.Type}, {"vre", Int64.Type}, {"bacteremia", Int64.Type},
        {"renal_dysfx", Int64.Type}, {"immunosuppressed", Int64.Type},
        {"action_deesc", Int64.Type}, {"action_disc", Int64.Type}, {"reviewed", Int64.Type},
        {"sofa_total", Int64.Type}, {"admit_type", type text}
    }),

    // Quitar filas vacías o de relleno (id nulo)
    SinVacios = Table.SelectRows(Tipos, each [id] <> null and [id] <> ""),

    // Columnas legibles (decodifican los códigos para los gráficos)
    ConAWaRe = Table.AddColumn(SinVacios, "AWaRe", each
        if [aware_1a_3r] = 1 then "Access"
        else if [aware_1a_3r] = 2 then "Watch"
        else if [aware_1a_3r] = 3 then "Reserve" else "Sin clasificar", type text),
    ConGravedad = Table.AddColumn(ConAWaRe, "Gravedad", each
        if [severity_0l_3c] = 0 then "Leve"
        else if [severity_0l_3c] = 1 then "Moderada"
        else if [severity_0l_3c] = 2 then "Grave"
        else if [severity_0l_3c] = 3 then "Crítica" else "—", type text),
    ConMDR = Table.AddColumn(ConGravedad, "EsMDR", each [mdr] = 1, type logical)
in
    ConMDR
```

### 4.2 Consulta de antibióticos (1 fila por ATB): `fctAntibioticos`

```m
let
    Ruta = "C:\StewardMX\StewardMX_reporte.xlsx",
    Origen = Excel.Workbook(File.Contents(Ruta), null, true),
    Hoja = Origen{[Item="Historial ATBs", Kind="Sheet"]}[Data],
    Encabezados = Table.PromoteHeaders(Hoja, [PromoteAllScalars=true]),
    Tipos = Table.TransformColumnTypes(Encabezados, {
        {"Paciente", type text}, {"Expediente", type text}, {"Servicio", type text},
        {"ATB", type text}, {"Días", Int64.Type}, {"Estado", type text},
        {"AWaRe", type text}, {"Política", type text},
        {"Fecha Inicio", type date}, {"Fecha Fin", type date}
    }),
    SinVacios = Table.SelectRows(Tipos, each [ATB] <> null and [ATB] <> "")
in
    SinVacios
```

### 4.3 Consulta de aislamientos: `fctAislamientos`

```m
let
    Ruta = "C:\StewardMX\StewardMX_reporte.xlsx",
    Origen = Excel.Workbook(File.Contents(Ruta), null, true),
    Hoja = Origen{[Item="Aislamientos Detalle", Kind="Sheet"]}[Data],
    Encabezados = Table.PromoteHeaders(Hoja, [PromoteAllScalars=true]),
    SinVacios = Table.SelectRows(Encabezados, each [Organismo] <> null and [Organismo] <> "")
in
    SinVacios
```

### 4.4 Tabla calendario (para análisis temporal): `dimCalendario`

```m
let
    Inicio = #date(2024,1,1),
    Fin = Date.From(DateTime.LocalNow()),
    Dias = Duration.Days(Fin - Inicio) + 1,
    Lista = List.Dates(Inicio, Dias, #duration(1,0,0,0)),
    Tabla = Table.FromList(Lista, Splitter.SplitByNothing(), {"Fecha"}),
    Tipos = Table.TransformColumnTypes(Tabla, {{"Fecha", type date}}),
    ConAño = Table.AddColumn(Tipos, "Año", each Date.Year([Fecha]), Int64.Type),
    ConMes = Table.AddColumn(ConAño, "Mes", each Date.Month([Fecha]), Int64.Type),
    ConMesNom = Table.AddColumn(ConMes, "MesNombre", each Date.ToText([Fecha], "MMMM", "es-MX"), type text),
    ConAñoMes = Table.AddColumn(ConMesNom, "AñoMes", each Date.ToText([Fecha], "yyyy-MM"), type text)
in
    ConAñoMes
```

> **Refresco:** Inicio → Actualizar todo. Como el nombre del archivo cambia por periodo, usa una **carpeta** (`Folder.Files`) y filtra el más reciente si quieres refresco automático mensual (ver §4.5).

### 4.5 (Opcional) Ingesta automática del último export de una carpeta

```m
let
    Carpeta = Folder.Files("C:\StewardMX\Exports"),
    SoloXlsx = Table.SelectRows(Carpeta, each Text.EndsWith([Name], ".xlsx")),
    MasReciente = Table.FirstN(Table.Sort(SoloXlsx, {{"Date modified", Order.Descending}}), 1),
    Contenido = MasReciente{0}[Content],
    Origen = Excel.Workbook(Contenido, null, true),
    Hoja = Origen{[Item="Análisis SPSS R", Kind="Sheet"]}[Data],
    Encabezados = Table.PromoteHeaders(Hoja, [PromoteAllScalars=true])
in
    Encabezados
```

---

## FASE 5 — Modelo Power BI (esquema estrella) + DAX

### 5.1 Esquema estrella recomendado

```
                 ┌────────────────┐
                 │ dimCalendario  │
                 │  (Fecha)       │
                 └───────┬────────┘
                         │ 1
                         │
                         │ *
┌──────────────┐   ┌─────┴──────────┐   ┌────────────────┐
│ dimServicio  │1 *│ fctPacientes   │* 1│ dimOrganismo   │
│ (service)    ├───┤ (1 fila/pac)   ├───┤ (organism)     │
└──────────────┘   └────┬───────────┘   └────────────────┘
                        │ 1
                        │ * (por Expediente/Paciente)
                   ┌────┴───────────┐
                   │ fctAntibioticos│
                   │ (1 fila/ATB)   │
                   └────────────────┘
```

- **Hechos:** `fctPacientes` (grano = paciente), `fctAntibioticos` (grano = ATB), `fctAislamientos` (grano = aislamiento).
- **Dimensiones:** `dimCalendario`, `dimServicio`, `dimOrganismo` (crea desde valores únicos con *Tablas calculadas* o Power Query `Table.Distinct`).
- **Relaciones:** `fctAntibioticos[Paciente]` → `fctPacientes` (por nombre/expediente); todas a `dimCalendario[Fecha]` por la fecha de inicio.

### 5.2 Medidas DAX (pegar en Power BI)

```dax
-- === Conteos base ===
N Pacientes = DISTINCTCOUNT(fctPacientes[id])
N ATB = COUNTROWS(fctAntibioticos)
DOT Total = SUM(fctPacientes[atb_doi])
DOT Promedio = DIVIDE([DOT Total], [N Pacientes])

-- === AWaRe (OMS) ===
% Access = DIVIDE(CALCULATE([N Pacientes], fctPacientes[aware_1a_3r] = 1), [N Pacientes])
% Watch = DIVIDE(CALCULATE([N Pacientes], fctPacientes[aware_1a_3r] = 2), [N Pacientes])
% Reserve = DIVIDE(CALCULATE([N Pacientes], fctPacientes[aware_1a_3r] = 3), [N Pacientes])

-- === Calidad microbiológica ===
% Cultivo Tomado = DIVIDE(CALCULATE([N Pacientes], fctPacientes[cult_taken] = 1), [N Pacientes])
% Cultivo Positivo = DIVIDE(
    CALCULATE([N Pacientes], fctPacientes[cult_positive] = 1),
    CALCULATE([N Pacientes], fctPacientes[cult_taken] = 1))
% MDR = DIVIDE(CALCULATE([N Pacientes], fctPacientes[mdr] = 1), [N Pacientes])

-- === Intervención PROA ===
% Desescalada = DIVIDE(CALCULATE([N Pacientes], fctPacientes[action_deesc] = 1), [N Pacientes])
% Restringido = DIVIDE(CALCULATE([N Pacientes], fctPacientes[restricted] = 1), [N Pacientes])
% Indicación Documentada = DIVIDE(CALCULATE([N Pacientes], fctPacientes[indication] = 1), [N Pacientes])

-- === Semáforo de meta (para formato condicional) ===
Estado Reserve =
VAR v = [% Reserve]
RETURN SWITCH(TRUE(), v < 0.10, "🟢 Cumple", v < 0.15, "🟠 Límite", "🔴 Alto")

Estado Access =
VAR v = [% Access]
RETURN SWITCH(TRUE(), v >= 0.60, "🟢 Cumple", v >= 0.50, "🟠 Cerca", "🔴 Bajo")

-- === SOFA / gravedad ===
SOFA Promedio = AVERAGE(fctPacientes[sofa_total])
SOFA Mediana = MEDIAN(fctPacientes[sofa_total])
% SOFA >= 2 = DIVIDE(CALCULATE([N Pacientes], fctPacientes[sofa_total] >= 2), [N Pacientes])

-- === Densidad de incidencia (requiere camas-día; sustituye [CamasDia] por tu medida/parámetro) ===
Tasa MDR /1000 pac-dia = DIVIDE(CALCULATE([N Pacientes], fctPacientes[mdr]=1) * 1000, [DOT Total])
```

### 5.3 Reportes sugeridos (visuales)

1. **Página Ejecutiva:** tarjetas KPI (% Access, % Reserve, % Cultivo, DOT/pac) con sus medidas `Estado *` como color; gráfico de dona AWaRe; línea de tendencia DOT por mes (`dimCalendario`).
2. **Página Resistencia:** matriz `dimOrganismo` × ATB con %R; segmentador por servicio; mapa de calor.
3. **Página Operativa:** tabla conectada a `Alertas PROA` (importa esa hoja como consulta directa) filtrada por severidad — la lista de trabajo del comité.
4. **Página Consumo:** `fctAntibioticos` por servicio y AWaRe; DOT por ATB (top 15).

### 5.4 Ruta a SQL (si más adelante migras de Excel a base de datos)

El esquema relacional ya está implícito en Firestore de tu app:

```sql
-- Esquema mínimo equivalente (PostgreSQL)
CREATE TABLE pacientes (
    id TEXT PRIMARY KEY, edad INT, sexo CHAR(1), servicio TEXT, cama TEXT,
    dx TEXT, dx_categoria TEXT, icd10 TEXT, severity SMALLINT,  -- 0..3
    aware SMALLINT, restricted BOOLEAN, indication BOOLEAN,
    cult_taken BOOLEAN, cult_positive BOOLEAN, organism TEXT, phenotype TEXT,
    mdr BOOLEAN, blee BOOLEAN, cre BOOLEAN, mrsa BOOLEAN, vre BOOLEAN,
    bacteremia BOOLEAN, sofa_total SMALLINT, fecha_ingreso DATE
);
CREATE TABLE antibioticos (
    id SERIAL PRIMARY KEY, paciente_id TEXT REFERENCES pacientes(id),
    nombre TEXT, dosis TEXT, via TEXT, aware SMALLINT,
    fecha_inicio DATE, fecha_fin DATE, dias INT, indicacion TEXT
);
CREATE TABLE aislamientos (
    id SERIAL PRIMARY KEY, paciente_id TEXT REFERENCES pacientes(id),
    fecha DATE, muestra TEXT, organismo TEXT, fenotipo TEXT, mdr BOOLEAN
);
CREATE INDEX idx_atb_paciente ON antibioticos(paciente_id);
CREATE INDEX idx_ais_paciente ON aislamientos(paciente_id);
```

> La hoja `Análisis SPSS/R` mapea 1:1 a la tabla `pacientes`; `Historial ATBs` a `antibioticos`; `Aislamientos Detalle` a `aislamientos`. Una carga inicial = importar esas 3 hojas. Power BI puede conectar directo a esta BD con DirectQuery cuando el volumen lo justifique.

---

## Checklist de implementación (Fases 4–5)

- [ ] Exportar un .xlsx de StewardMX y guardarlo en una carpeta fija (ej. `C:\StewardMX\Exports`).
- [ ] Power BI Desktop → pegar `fctPacientes` (§4.1) ajustando la ruta.
- [ ] Agregar `fctAntibioticos`, `fctAislamientos`, `dimCalendario`.
- [ ] Crear `dimServicio`/`dimOrganismo` (Table.Distinct o tabla calculada).
- [ ] Definir relaciones del esquema estrella (§5.1).
- [ ] Pegar las medidas DAX (§5.2).
- [ ] Construir las 4 páginas (§5.3).
- [ ] Probar refresco: exportar nuevo mes → Actualizar todo → cifras cambian.
- [ ] Validar: el `N Pacientes` de Power BI == el del Dashboard del Excel == el censo de la app.

---

*Estas fases no tocan el código de StewardMX. El Excel exportado es el contrato de datos; mientras la hoja `Análisis SPSS/R` mantenga sus columnas, este modelo de Power BI sigue funcionando export tras export.*
