
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
    ArrowRight,
    ChevronDown,
    ChevronRight,
    Globe,
    Search,
    ShieldCheck,
    Target as TargetIcon,
    X,
} from "lucide-react";
import { useTraffic } from "@/components/TrafficProvider";

type TrafficItem = {
    id: string;
    method: string;
    host: string;
    path: string;
    status: number | null;
    duration?: number | null;
    time: string;
};

type Endpoint = {
    key: string;
    host: string;
    path: string;
    methods: string[];
    latestStatus: number | null;
    count: number;
    latestTime: string;
};

type HostGroup = {
    host: string;
    endpoints: Endpoint[];
};

const METHOD_COLORS: Record<string, string> = {
    GET: "text-emerald-300",
    POST: "text-sky-300",
    PUT: "text-amber-300",
    PATCH: "text-amber-300",
    DELETE: "text-rose-300",
};

function statusColor(status: number | null) {
    if (status === null) return "text-[#777783]";
    if (status >= 500) return "text-rose-300";
    if (status >= 400) return "text-amber-300";
    if (status >= 300) return "text-sky-300";
    return "text-emerald-300";
}

function normalizeHost(host: string) {
    return host.trim().toLowerCase();
}

function normalizePath(path: string) {
    if (!path) return "/";
    const withoutQuery = path.split("?")[0];
    return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}

function getPathSegments(path: string) {
    return normalizePath(path)
        .split("/")
        .filter(Boolean);
}

export default function TargetPage() {
    const { history } = useTraffic();

    const [search, setSearch] = useState("");
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set());
    const [scopeHosts, setScopeHosts] = useState<Set<string>>(new Set());
    const [scopeInitialized, setScopeInitialized] = useState(false);
    const [showScopeOnly, setShowScopeOnly] = useState(false);

    const traffic: TrafficItem[] = history.map((item) => ({
        ...item,
        id: String(item.id),
    }));

    const endpoints = useMemo<Endpoint[]>(() => {
        const grouped = new Map<string, Endpoint>();

        for (const item of traffic) {
            const host = normalizeHost(item.host || "unknown host");
            const path = normalizePath(item.path || "/");
            const key = `${host}${path}`;

            const existing = grouped.get(key);

            if (existing) {
                existing.count += 1;
                if (!existing.methods.includes(item.method)) {
                    existing.methods.push(item.method);
                }
                existing.latestStatus = item.status;
                existing.latestTime = item.time;
            } else {
                grouped.set(key, {
                    key,
                    host,
                    path,
                    methods: [item.method],
                    latestStatus: item.status,
                    count: 1,
                    latestTime: item.time,
                });
            }
        }

        return [...grouped.values()].sort((a, b) =>
            a.host === b.host
                ? a.path.localeCompare(b.path)
                : a.host.localeCompare(b.host)
        );
    }, [traffic]);

    const allHosts = useMemo(
        () => [...new Set(endpoints.map((item) => item.host))].sort(),
        [endpoints]
    );

    // Initialize scope to all currently observed hosts.
    if (!scopeInitialized && allHosts.length > 0) {
        setScopeHosts(new Set(allHosts));
        setScopeInitialized(true);
    }

    const filteredEndpoints = useMemo(() => {
        const query = search.trim().toLowerCase();

        return endpoints.filter((endpoint) => {
            const matchesSearch =
                !query ||
                endpoint.host.includes(query) ||
                endpoint.path.toLowerCase().includes(query) ||
                endpoint.methods.some((method) =>
                    method.toLowerCase().includes(query)
                );

            const matchesScope = !showScopeOnly || scopeHosts.has(endpoint.host);

            return matchesSearch && matchesScope;
        });
    }, [endpoints, search, showScopeOnly, scopeHosts]);

    const hostGroups = useMemo<HostGroup[]>(() => {
        const grouped = new Map<string, Endpoint[]>();

        for (const endpoint of filteredEndpoints) {
            const items = grouped.get(endpoint.host) ?? [];
            items.push(endpoint);
            grouped.set(endpoint.host, items);
        }

        return [...grouped.entries()].map(([host, items]) => ({
            host,
            endpoints: items,
        }));
    }, [filteredEndpoints]);

    const selectedEndpoint =
        endpoints.find((endpoint) => endpoint.key === selectedKey) ?? null;

    const selectedTraffic = useMemo(() => {
        if (!selectedEndpoint) return [];

        return traffic
            .filter(
                (item) =>
                    normalizeHost(item.host || "unknown host") === selectedEndpoint.host &&
                    normalizePath(item.path || "/") === selectedEndpoint.path
            )
            .slice(-10)
            .reverse();
    }, [traffic, selectedEndpoint]);

    const toggleHost = (host: string) => {
        setExpandedHosts((current) => {
            const next = new Set(current);
            if (next.has(host)) next.delete(host);
            else next.add(host);
            return next;
        });
    };

    const toggleScope = (host: string) => {
        setScopeHosts((current) => {
            const next = new Set(current);
            if (next.has(host)) next.delete(host);
            else next.add(host);
            return next;
        });
    };

    const totalHosts = allHosts.length;
    const inScopeCount = allHosts.filter((host) => scopeHosts.has(host)).length;

    return (
        <main className="min-h-full w-full px-5 py-6 md:px-8 md:py-8">
            <div className="mx-auto w-full max-w-[1500px]">
                {/* Header */}
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="text-xs text-[#777783]">
                            PACKET SNIFFER / WORKSPACE
                        </div>
                        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                            Target
                        </h1>
                        <p className="mt-1 max-w-2xl text-sm text-[#858591]">
                            Explore discovered hosts and endpoints from captured traffic.
                        </p>
                    </div>

                    <Link
                        href="/http-history"
                        className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#171719] px-3 py-2 text-xs text-[#c4c4ce] transition hover:border-emerald-400/25 hover:text-emerald-300"
                    >
                        Open HTTP History <ArrowRight size={14} />
                    </Link>
                </header>

                {/* Summary */}
                <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/[0.07] bg-[#171719] p-4">
                        <div className="flex items-center gap-2 text-xs text-[#858591]">
                            <Globe size={15} className="text-cyan-400" />
                            Hosts discovered
                        </div>
                        <div className="mt-3 text-2xl font-semibold text-white">
                            {totalHosts}
                        </div>
                    </div>

                    <div className="rounded-xl border border-white/[0.07] bg-[#171719] p-4">
                        <div className="flex items-center gap-2 text-xs text-[#858591]">
                            <TargetIcon size={15} className="text-emerald-400" />
                            Endpoints
                        </div>
                        <div className="mt-3 text-2xl font-semibold text-white">
                            {endpoints.length}
                        </div>
                    </div>

                    <div className="rounded-xl border border-white/[0.07] bg-[#171719] p-4">
                        <div className="flex items-center gap-2 text-xs text-[#858591]">
                            <ShieldCheck size={15} className="text-violet-400" />
                            In scope
                        </div>
                        <div className="mt-3 text-2xl font-semibold text-white">
                            {inScopeCount}
                            <span className="ml-2 text-sm font-normal text-[#777783]">
                                / {totalHosts} hosts
                            </span>
                        </div>
                    </div>
                </section>

                {/* Main workspace */}
                <section className="mt-6 grid min-h-[620px] grid-cols-1 overflow-hidden rounded-xl border border-white/[0.07] bg-[#171719] lg:grid-cols-[340px_minmax(0,1fr)]">
                    {/* Site map sidebar */}
                    <aside className="border-b border-white/[0.07] lg:border-b-0 lg:border-r">
                        <div className="border-b border-white/[0.07] p-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm font-semibold text-[#e5e5ec]">
                                    Site map
                                </h2>
                                <span className="text-xs text-[#777783]">
                                    {filteredEndpoints.length} endpoints
                                </span>
                            </div>

                            <div className="relative mt-3">
                                <Search
                                    size={14}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777783]"
                                />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search hosts or paths"
                                    className="w-full rounded-lg border border-white/[0.08] bg-[#101012] py-2 pl-9 pr-9 text-xs text-[#e5e5ec] outline-none placeholder:text-[#666672] focus:border-emerald-400/30"
                                />
                                {search && (
                                    <button
                                        onClick={() => setSearch("")}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#777783] hover:text-white"
                                        aria-label="Clear search"
                                    >
                                        <X size={13} />
                                    </button>
                                )}
                            </div>

                            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-[#858591]">
                                <input
                                    type="checkbox"
                                    checked={showScopeOnly}
                                    onChange={(event) => setShowScopeOnly(event.target.checked)}
                                    className="accent-emerald-400"
                                />
                                Show in-scope hosts only
                            </label>
                        </div>

                        <div className="max-h-[620px] overflow-y-auto p-2">
                            {hostGroups.length === 0 ? (
                                <div className="px-3 py-10 text-center">
                                    <p className="text-xs text-[#858591]">
                                        {traffic.length === 0
                                            ? "No hosts discovered yet."
                                            : "No matching hosts or endpoints."}
                                    </p>
                                    {traffic.length === 0 && (
                                        <p className="mt-2 text-[11px] text-[#666672]">
                                            Start the proxy and browse your target.
                                        </p>
                                    )}
                                </div>
                            ) : (
                                hostGroups.map((group) => {
                                    const expanded =
                                        expandedHosts.has(group.host) ||
                                        search.trim().length > 0;
                                    const inScope = scopeHosts.has(group.host);

                                    return (
                                        <div key={group.host} className="mb-1">
                                            <div className="flex items-center rounded-lg hover:bg-white/[0.03]">
                                                <button
                                                    onClick={() => toggleHost(group.host)}
                                                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                                                >
                                                    {expanded ? (
                                                        <ChevronDown
                                                            size={14}
                                                            className="shrink-0 text-[#777783]"
                                                        />
                                                    ) : (
                                                        <ChevronRight
                                                            size={14}
                                                            className="shrink-0 text-[#777783]"
                                                        />
                                                    )}
                                                    <Globe
                                                        size={14}
                                                        className="shrink-0 text-cyan-400"
                                                    />
                                                    <span className="truncate text-xs text-[#d4d4dc]">
                                                        {group.host}
                                                    </span>
                                                    <span className="ml-auto text-[10px] text-[#666672]">
                                                        {group.endpoints.length}
                                                    </span>
                                                </button>

                                                <button
                                                    onClick={() => toggleScope(group.host)}
                                                    title={inScope ? "Remove from scope" : "Add to scope"}
                                                    className={`mr-2 rounded-md border px-2 py-1 text-[10px] transition ${inScope
                                                            ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300"
                                                            : "border-white/[0.07] text-[#777783] hover:text-[#c4c4ce]"
                                                        }`}
                                                >
                                                    {inScope ? "In scope" : "Add"}
                                                </button>
                                            </div>

                                            {expanded && (
                                                <div className="ml-5 border-l border-white/[0.06] pl-2">
                                                    {group.endpoints.map((endpoint) => (
                                                        <button
                                                            key={endpoint.key}
                                                            onClick={() => setSelectedKey(endpoint.key)}
                                                            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition ${selectedKey === endpoint.key
                                                                    ? "bg-emerald-400/[0.09] text-emerald-200"
                                                                    : "text-[#92929e] hover:bg-white/[0.03] hover:text-[#d4d4dc]"
                                                                }`}
                                                        >
                                                            <span className="shrink-0 text-[#666672]">↳</span>
                                                            <span className="truncate font-mono text-[11px]">
                                                                {endpoint.path}
                                                            </span>
                                                            <span className="ml-auto shrink-0 text-[10px] text-[#666672]">
                                                                {endpoint.count}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </aside>

                    {/* Endpoint details */}
                    <div className="min-w-0">
                        {!selectedEndpoint ? (
                            <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
                                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-[#777783]">
                                    <TargetIcon size={20} />
                                </div>
                                <h3 className="mt-4 text-sm font-medium text-[#d4d4dc]">
                                    Select an endpoint
                                </h3>
                                <p className="mt-2 max-w-sm text-xs leading-5 text-[#777783]">
                                    Choose a host or path from the site map to view its captured
                                    traffic details.
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="border-b border-white/[0.07] p-5">
                                    <div className="text-xs text-[#777783]">Endpoint details</div>
                                    <h2 className="mt-2 break-all font-mono text-sm text-white">
                                        {selectedEndpoint.host}
                                        {selectedEndpoint.path}
                                    </h2>

                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {selectedEndpoint.methods.map((method) => (
                                            <span
                                                key={method}
                                                className={`rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 font-mono text-[10px] ${METHOD_COLORS[method] ?? "text-[#c4c4ce]"
                                                    }`}
                                            >
                                                {method}
                                            </span>
                                        ))}
                                        <span
                                            className={`rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 font-mono text-[10px] ${statusColor(
                                                selectedEndpoint.latestStatus
                                            )}`}
                                        >
                                            {selectedEndpoint.latestStatus ?? "No response"}
                                        </span>
                                        <span className="rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[10px] text-[#92929e]">
                                            {selectedEndpoint.count} captured
                                        </span>
                                    </div>

                                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                        <div className="text-xs text-[#777783]">
                                            Latest: {selectedEndpoint.latestTime}
                                        </div>
                                        <Link
                                            href="/http-history"
                                            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
                                        >
                                            View in HTTP History <ArrowRight size={13} />
                                        </Link>
                                    </div>
                                </div>

                                <div className="p-5">
                                    <div className="mb-3 flex items-center justify-between">
                                        <h3 className="text-sm font-medium text-[#e5e5ec]">
                                            Recent requests
                                        </h3>
                                        <span className="text-xs text-[#777783]">
                                            Latest {selectedTraffic.length}
                                        </span>
                                    </div>

                                    {selectedTraffic.length === 0 ? (
                                        <p className="py-8 text-center text-xs text-[#777783]">
                                            No matching request records.
                                        </p>
                                    ) : (
                                        <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
                                            <table className="w-full min-w-[440px] text-left">
                                                <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-[#777783]">
                                                    <tr>
                                                        <th className="px-3 py-2.5 font-medium">Method</th>
                                                        <th className="px-3 py-2.5 font-medium">Status</th>
                                                        <th className="px-3 py-2.5 font-medium">Time</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedTraffic.map((item) => (
                                                        <tr
                                                            key={item.id}
                                                            className="border-t border-white/[0.05]"
                                                        >
                                                            <td
                                                                className={`px-3 py-2.5 font-mono text-xs ${METHOD_COLORS[item.method] ??
                                                                    "text-[#c4c4ce]"
                                                                    }`}
                                                            >
                                                                {item.method}
                                                            </td>
                                                            <td
                                                                className={`px-3 py-2.5 font-mono text-xs ${statusColor(
                                                                    item.status
                                                                )}`}
                                                            >
                                                                {item.status ?? "—"}
                                                            </td>
                                                            <td className="px-3 py-2.5 font-mono text-[11px] text-[#858591]">
                                                                {item.time}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </section>

                <p className="mt-4 text-[11px] text-[#666672]">
                    Site map entries are derived from captured HTTP History. Scope choices
                    currently affect this page’s filtering only; proxy-level scope
                    enforcement is not connected yet.
                </p>
            </div>
        </main>
    );
}
