export enum LogLvl {
	DEBUG = 1,
	INFO = 2,
	WARN = 3,
	ERROR = 4,
	DISABLED = 5,
}

let logLevel = LogLvl.DEBUG;

/** Current log level. Exposed so other modules (e.g. the startup profiler) can gate work. */
export function getLogLevel(): LogLvl {
	return logLevel;
}

export const Logger = {
	setLogLevel(level: LogLvl) {
		logLevel = level;
	},

	debug(...args: unknown[]) {
		if (logLevel <= LogLvl.DEBUG) console.debug("[S2B]", ...args);
	},

	log(...args: unknown[]) {
		if (logLevel <= LogLvl.INFO) console.log("[S2B]", ...args);
	},

	info(...args: unknown[]) {
		if (logLevel <= LogLvl.INFO) console.info("[S2B]", ...args);
	},

	warn(...args: unknown[]) {
		if (logLevel <= LogLvl.WARN) console.warn("[S2B]", ...args);
	},

	error(...args: unknown[]) {
		if (logLevel <= LogLvl.ERROR) console.error("[S2B]", ...args);
	},
};
