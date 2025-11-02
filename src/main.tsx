import {
    render,
    useKeyboard,
    useTerminalDimensions,
} from "@opentui/react"
import { TextAttributes } from "@opentui/core"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import type {
    NearbyDeparturesResponse as NearbyResponse,
    Direction,
    Trip,
} from "./birchtypes.ts"
import type { SearchResultResponse } from "./searchtypes.ts"

const BIRCH = "https://birch.catenarymaps.org"

function App() {
    const [screen, setScreen] = useState<"menu" | "search" | "table" | "grid">("menu")
    const [location, setLocation] = useState<{
        name: string
        lat: number
        lon: number
    } | null>(null)

    if (screen === "menu")
        return (
            <MainMenu
                location={location}
                onSetLocation={() => setScreen("search")}
                onSelect={(view) => setScreen(view)}
            />
        )

    if (screen === "search")
        return (
            <SearchLocation
                onPick={(name, lat, lon) => {
                    setLocation({ name, lat, lon })
                    setScreen("menu")
                }}
                onBack={() => setScreen("menu")}
            />
        )

    if (screen === "table" && location)
        return <Board view="table" location={location} onBack={() => setScreen("menu")} />
    if (screen === "grid" && location)
        return <Board view="grid" location={location} onBack={() => setScreen("menu")} />

    return <text>Loading...</text>
}

function MainMenu({
                      location,
                      onSetLocation,
                      onSelect,
                  }: {
    location: { name: string; lat: number; lon: number } | null
    onSetLocation: () => void
    onSelect: (view: "grid" | "table" | "menu") => void
}) {
    const [selected, setSelected] = useState(0)
    const locLabel = location ? `📍 ${location.name}` : "📍 Set Location"
    const options = [
        { name: locLabel, action: onSetLocation },
        { name: "🧭 Grid Route View", action: () => onSelect("grid"), disabled: !location },
        { name: "📋 Compact Table View", action: () => onSelect("table"), disabled: !location },
        { name: "Quit", action: () => process.exit(0) },
    ]

    useKeyboard((key) => {
        if (key.name === "up") setSelected((p) => (p > 0 ? p - 1 : options.length - 1))
        else if (key.name === "down" || key.name === "tab")
            setSelected((p) => (p + 1) % options.length)
        else if (key.name === "return" && !options[selected].disabled)
            options[selected].action()
    })

    return (
        <box
            enableLayout
            style={{
                border: true,
                borderStyle: "double",
                padding: 2,
                flexDirection: "column",
                alignItems: "center",
            }}
        >
            <ascii-font text="Catenary Matrix" font="tiny"/>
            <text fg="#999" style={{marginBottom: 1}}>
                Your terminal transit departure board.
            </text>
            {!location && (
                <text fg={'yellow'} style={{marginTop: 1}} >
                    ⚠ Set a location before viewing departures
                </text>
            )}
            {options.map((opt, i) => (
                <text
                    key={opt.name}
                    fg={opt.disabled ? "#555" : i === selected ? "#ffffff" : "#777777"}
                    attributes={
                        opt.disabled
                            ? TextAttributes.DIM
                            : i === selected
                                ? TextAttributes.BOLD
                                : undefined
                    }
                >
                    {i === selected ? "› " : "  "}
                    {opt.name}
                </text>
            ))}
            <text fg="#999" style={{marginTop: 1}}>
                use ↑ ↓ or tab to select • enter to confirm
            </text>
        </box>
    )
}

function SearchLocation({
                            onPick,
                            onBack,
                        }: {
    onPick: (name: string, lat: number, lon: number) => void
    onBack: () => void
}) {
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<{ name: string; lat: number; lon: number }[]>([])
    const [selected, setSelected] = useState(0)
    const [loading, setLoading] = useState(true)
    const [focus, setFocus] = useState<"auto" | "search" | "manual">("auto")
    const [manualFocus, setManualFocus] = useState<"lat" | "lon" | "confirm">("lat")
    const [manualLat, setManualLat] = useState("")
    const [manualLon, setManualLon] = useState("")
    const [cfInfo, setCfInfo] = useState<{ name: string; lat: number; lon: number } | null>(null)
    const { width, height } = useTerminalDimensions()

    const queryRef = useRef("")
    const debounceRef = useRef<NodeJS.Timeout | null>(null)
    const header = useMemo(() => <ascii-font text="SET LOCATION!" font="block" />, [])

    // === 1. Try CF detection once ===
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch("https://cf-object.quacksire.workers.dev/")
                const cf = await res.json()
                const lat = parseFloat(cf.latitude)
                const lon = parseFloat(cf.longitude)
                if (!isNaN(lat) && !isNaN(lon) && cf.city && cf.region) {
                    const name = `${cf.city}, ${cf.region}`
                    setCfInfo({ name, lat, lon })
                    setQuery(cf.city)
                }
            } catch {
                // ignore errors
            } finally {
                setLoading(false)
            }
        })()
    }, [])

    // === 2. Search function ===
    const search = useCallback(async (q: string) => {
        if (!q.trim()) {
            setResults([])
            return
        }
        setLoading(true)
        try {
            const res = await fetch(`${BIRCH}/text_search_v1?text=${encodeURIComponent(q)}`)
            const json: SearchResultResponse = await res.json()
            const ranking = json.stops_section.ranking
            const stops = json.stops_section.stops
            const mapped = ranking
                .map((r) => {
                    const found = Object.values(stops)
                        .flatMap((s) => Object.values(s))
                        .find((ss) => ss.gtfs_id === r.gtfs_id)
                    return found
                        ? { name: found.name, lat: found.point.y, lon: found.point.x }
                        : null
                })
                .filter(Boolean) as { name: string; lat: number; lon: number }[]
            setResults(mapped)
            setSelected(0)
        } catch {
            setResults([])
        } finally {
            setLoading(false)
        }
    }, [])

    // === 3. Debounce search ===
    useEffect(() => {
        if (focus !== "search") return
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            if (query.trim()) search(query)
        }, 400)
    }, [query, search, focus])

    // === 4. Keyboard navigation ===
    useKeyboard((key) => {
        if (key.name === "escape") return onBack()

        // === Manual mode navigation ===
        if (focus === "manual") {
            if (key.name === "tab" || key.name === "down") {
                setManualFocus((p) => (p === "lat" ? "lon" : p === "lon" ? "confirm" : "lat"))
                return
            }

            if (key.name === "up") {
                setManualFocus((p) => (p === "confirm" ? "lon" : p === "lon" ? "lat" : "confirm"))
                return
            }

            // --- Confirm action ---
            if (key.name === "return" && manualFocus === "confirm") {
                const lat = parseFloat(manualLat)
                const lon = parseFloat(manualLon)
                if (!isNaN(lat) && !isNaN(lon)) {
                    onPick(`Manual (${lat.toFixed(3)}, ${lon.toFixed(3)})`, lat, lon)
                }
                return
            }
            return
        }

        // === Tab between modes ===
        if (key.name === "tab") {
            setFocus((prev) =>
                prev === "auto" ? "search" : prev === "search" ? "manual" : "auto"
            )
            return
        }

        // === Auto-detected confirm ===
        if (focus === "auto" && key.name === "return" && cfInfo)
            onPick(cfInfo.name, cfInfo.lat, cfInfo.lon)

        // === Search mode ===
        if (focus === "search") {
            if (key.name === "down") setSelected((p) => Math.min(p + 1, results.length - 1))
            else if (key.name === "up") setSelected((p) => Math.max(p - 1, 0))
            else if (key.name === "return" && results[selected])
                onPick(results[selected].name, results[selected].lat, results[selected].lon)
        }
    })

    //if (loading) return <text fg="#999">Detecting your location...</text>

    const sectionWidth = Math.floor(width * 0.7)

    return (
        <box
            enableLayout={true}
            style={{
                border: true,
                borderStyle: "double",
                padding: 2,
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                width: "100%",
            }}
        >
            {header}
            <text fg="#888">Press [Tab] to switch • [Enter] to confirm • [Esc] to go back</text>

            {/* Tab header */}
            <text fg="#00FFFF" attributes={TextAttributes.BOLD}>
                {focus === "auto" ? "› AUTO-DETECTED" : "  AUTO-DETECTED"}
                {focus === "search" ? "› SEARCH" : "  SEARCH"}
                {focus === "manual" ? "› MANUAL" : "  MANUAL"}
            </text>

            {/* Auto-detected */}
            {focus === "auto" && (
                <box
                    style={{
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 1,
                    }}
                >
                    {cfInfo ? (
                        <>
                            <text fg="#00FF66">
                                Detected location: <strong>{cfInfo.name}</strong>
                            </text>
                            <text fg="#999">(Press Enter to confirm or Tab to change)</text>
                        </>
                    ) : (
                        <text fg="#666">No location detected</text>
                    )}
                </box>
            )}

            {/* Search */}
            {focus === "search" && (
                <box
                    style={{
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 1,
                        width: sectionWidth,
                    }}
                >
                    <box
                        title="Search"
                        style={{
                            border: true,
                            height: 3,
                            width: "100%",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <input
                            placeholder="e.g. San Jose Diridon, Palo Alto"
                            value={query}
                            onInput={(v) => setQuery(v)}
                            focused={true}
                            alignSelf={'center'}
                            style={{ width: "100%", alignItems: "center" }}
                        />
                    </box>

                    <scrollbox
                        style={{
                            flexDirection: "column",
                            width: "100%",
                            height: Math.min(height - 10, 15),
                            marginTop: 1,
                        }}
                    >
                        {results.length > 0
                            ? results.map((r, i) => (
                                <text
                                    key={`${r.name}-${r.lat}`}
                                    fg={i === selected ? "#00FF66" : "#CCCCCC"}
                                    attributes={i === selected ? TextAttributes.BOLD : undefined}
                                >
                                    {i === selected ? "› " : "  "}
                                    {r.name}{" "}
                                    <span fg="#666">
                      ({r.lat.toFixed(3)}, {r.lon.toFixed(3)})
                    </span>
                                </text>
                            ))
                            : !loading && query && <text fg="#555">No results for "{query}"</text>}
                    </scrollbox>
                </box>
            )}

            {/* Manual Coordinates */}
            {focus === "manual" && (
                <box
                    title="Manual Coordinates"
                    style={{
                        border: true,
                        flexDirection: "column",
                        width: Math.floor(width * 0.7),
                        padding: 1,
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 2,
                    }}
                >
                    <text fg="#999" style={{ marginBottom: 1, textAlign: "center" }}>
                        Use ↑ ↓ or Tab to move between fields • Enter to confirm
                    </text>

                    <box
                        enableLayout
                        style={{
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 1,
                            width: "80%",
                        }}
                    >
                        {/* latitude row */}
                        <box
                            enableLayout
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "center",
                                width: "100%",
                                gap: 2,
                            }}
                        >
                            <text
                                fg={manualFocus === "lat" ? "#00FFFF" : "#ccc"}
                                style={{ width: 12, textAlign: "right" }}
                            >
                                Latitude:
                            </text>
                            <input
                                placeholder="37.33"
                                value={manualLat}
                                onInput={setManualLat}
                                focused={manualFocus === "lat"}
                                style={{ width: 14, textAlign: "left" }}
                            />
                        </box>

                        {/* longitude row */}
                        <box
                            enableLayout={true}
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "center",
                                width: "100%",
                                gap: 2,
                            }}
                        >
                            <text
                                fg={manualFocus === "lon" ? "#00FFFF" : "#ccc"}
                                style={{ width: 12, textAlign: "right" }}
                            >
                                Longitude:
                            </text>
                            <input
                                placeholder="-121.89"
                                value={manualLon}
                                onInput={setManualLon}
                                focused={manualFocus === "lon"}
                                style={{ width: 14, textAlign: "left" }}
                            />
                        </box>

                        <text
                            fg={manualFocus === "confirm" ? "#00FF66" : "#666"}
                            attributes={manualFocus === "confirm" ? TextAttributes.BOLD : undefined}
                            alignSelf={'center'}
                            style={{ marginTop: 2, textAlign: "center" }}
                        >
                            {manualFocus === "confirm" ? "› Confirm" : "  Confirm"}
                        </text>
                    </box>
                </box>
            )}
        </box>
    )
}

function Board({
                   view,
                   location,
                   onBack,
               }: {
    view: "grid" | "table"
    location: { name: string; lat: number; lon: number }
    onBack: () => void
}) {
    const [data, setData] = useState<NearbyResponse | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
    const [is24h, setIs24h] = useState(false)
    const [highlighted, setHighlighted] = useState<Record<string, number>>({})
    const prevDataRef = useRef<NearbyResponse | null>(null)
    const { width, height } = useTerminalDimensions()

    const fetchDepartures = useCallback(async () => {
        try {
            const res = await fetch(
                `${BIRCH}/nearbydeparturesfromcoords?lat=${location.lat}&lon=${location.lon}`,
            )
            const json: NearbyResponse = await res.json()
            if (prevDataRef.current) {
                const oldDepartures = Object.fromEntries(
                    prevDataRef.current.departures.map((d) => [d.chateau_id, d]),
                )
                const changed: Record<string, number> = {}
                for (const dep of json.departures) {
                    const old = oldDepartures[dep.chateau_id]
                    if (!old) continue
                    const oldTimes = Object.values(old.directions).flatMap((dir) =>
                        dir.trips.map((t) => t.departure_realtime ?? t.departure_schedule ?? 0),
                    )
                    const newTimes = Object.values(dep.directions).flatMap((dir) =>
                        dir.trips.map((t) => t.departure_realtime ?? t.departure_schedule ?? 0),
                    )
                    if (JSON.stringify(oldTimes.slice(0, 3)) !== JSON.stringify(newTimes.slice(0, 3)))
                        changed[dep.chateau_id] = Date.now()
                }
                if (Object.keys(changed).length > 0) setHighlighted(changed)
            }
            prevDataRef.current = json
            setData(json)
            setLastUpdated(new Date())
            setError(null)
        } catch {
            setError("⚠ Unable to refresh data.")
        }
    }, [location])

    useEffect(() => {
        fetchDepartures()
    }, [fetchDepartures])

    useEffect(() => {
        const interval = setInterval(fetchDepartures, 60_000)
        return () => clearInterval(interval)
    }, [fetchDepartures])

    useKeyboard((key) => {
        if (key.name === "r") fetchDepartures()
        else if (key.name === "t") setIs24h((p) => !p)
        else if (key.name === "escape") onBack()
        else if (key.name === "q") process.exit(0)
    })

    if (!data) return <text>Loading...</text>

    const now = Math.floor(Date.now() / 1000)
    const formatTime = (s: number) =>
        new Date(s * 1000).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: !is24h,
        })

    const titlePrefix = `${view === "grid" ? "🧭" : "📋"} ${location.name}`
    const footer = `[r: refresh] [t: ${is24h ? "12h" : "24h"}] [esc: back] [q: quit]`

    // === TABLE VIEW ===
// === TABLE VIEW ===
    if (view === "table") {
        const trips = data.departures
            .flatMap((dep) =>
                Object.values(dep.directions).flatMap((dir) =>
                    dir.trips.map((t) => ({
                        dep,
                        dir,
                        t,
                        when: t.departure_realtime ?? t.departure_schedule ?? 0,
                    })),
                ),
            )
            .filter((x) => x.when > now)
            .sort((a, b) => a.when - b.when)

        // dynamically rebalanced column widths
        const COL_ROUTE = Math.max(10, Math.floor(width * 0.18))
        const COL_DEST = Math.max(22, Math.floor(width * 0.55))
        const COL_TIME = Math.max(18, width - COL_ROUTE - COL_DEST - 6)

        // internal sub-columns for time field
        const DOT_W = 2
        const MAIN_W = is24h ? 5 : 8 // fits 12:59 or 23:59 AM
        const SEP_W = 1
        const SUF_W = Math.max(0, COL_TIME - DOT_W - MAIN_W - SEP_W)

        return (
            <box
                title={`${titlePrefix} — ${footer}`}
                enableLayout
                style={{
                    border: true,
                    borderStyle: "rounded",
                    flexDirection: "column",
                    width,
                    height,
                }}
            >
                {error && <text fg="red">{error}</text>}

                {/* Header */}
                <text fg="#8888FF">
                    {"ROUTE".padEnd(COL_ROUTE + 2)}
                    {"DESTINATION".padEnd(COL_DEST)}
                    {"DEPARTS"}
                </text>

                <scrollbox
                    focused
                    style={{
                        width,
                        height: height - 4,
                        flexDirection: "column",
                    }}
                >


                    {/* Rows */}
                    {trips.slice(0, 120).map(({ dep, dir, t }) => {
                        const sched = t.departure_schedule
                        const realtime = t.departure_realtime
                        const delaySecs = realtime && sched ? realtime - sched : 0
                        const isDelayed = delaySecs > 300
                        const isCanceled = t.cancelled
                        const isLive = !!realtime && !isCanceled

                        const routeColor = dep.color || "#888"
                        const dotColor = isCanceled
                            ? "#000"
                            : isDelayed
                                ? "#F33"
                                : isLive
                                    ? "#0F6"
                                    : "#CCC"

                        const schedStr = sched ? formatTime(sched) : "—"
                        const rtStr = realtime ? formatTime(realtime) : schedStr
                        const delayMin = Math.max(0, Math.round(delaySecs / 60))

                        // left sub-column = scheduled time always
                        let mainTime = schedStr
                        if (isCanceled)
                            mainTime = mainTime.split("").map((c) => c + "\u0336").join("")
                        const mainCell = mainTime.slice(0, MAIN_W).padEnd(MAIN_W)

                        // right sub-column = only for delayed trips
                        const suffix = isDelayed ? `→ ${rtStr} (+${delayMin}m)` : ""
                        const suffixCell = suffix.slice(0, SUF_W).padEnd(SUF_W)

                        const routeText = (dep.short_name || dep.long_name || "")
                            .slice(0, COL_ROUTE - 1)
                            .padEnd(COL_ROUTE)
                        const destText = (dir.headsign || "")
                            .slice(0, COL_DEST - 1)
                            .padEnd(COL_DEST)

                        return (
                            <text key={t.trip_id}>
                                {/* route + destination */}
                                <span fg={routeColor}>▉ </span>
                                <span fg="#ccc">{routeText}</span>
                                <span fg="#ccc">{destText}</span>

                                {/* time column: dot + mainTime + suffix */}
                                <span fg={dotColor}>{"● ".slice(0, DOT_W)}</span>
                                <span
                                    fg={isCanceled ? "#F33" : "#fff"}
                                    attributes={TextAttributes.BOLD}
                                >
                {mainCell}
              </span>
                                <span>{" ".repeat(SEP_W)}</span>
                                <span fg={isDelayed ? "#F55" : "#999"}>{suffixCell}</span>
                            </text>
                        )
                    })}
                </scrollbox>
            </box>
        )
    }

    // === GRID VIEW ===
    const cutoffSecs = 150 * 60
    let columns = 1
    if (width >= 160) columns = 4
    else if (width >= 120) columns = 3
    else if (width >= 80) columns = 2

    const boxWidth = Math.floor(width / columns) - 2 // pixel-based width per card

    return (
        <box
            title={`${titlePrefix} — ${footer}`}
            enableLayout
            style={{
                border: true,
                borderStyle: "double",
                width,
                height,
                padding: 1,
                flexDirection: "column",
            }}
        >
            {error && <text fg="red">{error}</text>}
            <scrollbox focused style={{ width, height: height - 4 }}>
                <box style={{ width, flexDirection: "row", flexWrap: "wrap" }}>
                    {data.departures
                        .map((dep) => {
                            // Filter trips per route using the 150-minute cutoff
                            const validDirections = Object.values(dep.directions)
                                .map((dir) => {
                                    const validTrips = dir.trips.filter((t) => {
                                        const ts = t.departure_realtime ?? t.departure_schedule
                                        return ts && ts > now && ts - now <= cutoffSecs
                                    })
                                    return { ...dir, trips: validTrips }
                                })
                                .filter((d) => d.trips.length > 0)

                            if (validDirections.length === 0) return null // hide route if none within cutoff

                            const isHighlighted =
                                highlighted[dep.chateau_id] &&
                                Date.now() - highlighted[dep.chateau_id] < 3000
                            const borderColor = isHighlighted
                                ? Date.now() % 400 < 200
                                    ? "#0F6"
                                    : "#222"
                                : dep.color || "#888"

                            return (
                                <box
                                    key={dep.chateau_id}
                                    title={`${dep.short_name || dep.long_name}`}
                                    style={{
                                        border: true,
                                        width: boxWidth,
                                        minHeight: 8,
                                        marginRight: 1,
                                        marginBottom: 1,
                                        padding: 1,
                                        borderColor,
                                        flexDirection: "column",
                                    }}
                                >
                                    {validDirections.map((dir) => (
                                        <box key={dir.direction_id} style={{ flexDirection: "column", width: "100%" }}>
                                            <text>
                                                → <strong>{dir.headsign}</strong>
                                            </text>
                                            {dir.trips.slice(0, 3).map((t) => {
                                                const ts = t.departure_realtime ?? t.departure_schedule
                                                const mins = ts ? Math.floor((ts - now) / 60) : 0
                                                const fg = mins < 5 ? "#0F6" : mins < 30 ? "#FF3" : "#CCC"
                                                return (
                                                    <text key={t.trip_id} fg={fg}>
                                                        {formatTime(ts!)} ({mins}m)
                                                    </text>
                                                )
                                            })}
                                        </box>
                                    ))}
                                </box>
                            )
                        })
                        .filter(Boolean)}
                </box>
            </scrollbox>
        </box>
    )
}

render(<App />)
