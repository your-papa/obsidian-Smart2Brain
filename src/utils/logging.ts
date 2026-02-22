export enum LogLvl {
	DEBUG = 1,
	INFO = 2,
	WARN = 3,
	ERROR = 4,
	DISABLED = 5,
}

class Logger {
	private static logLevel = LogLvl.DEBUG;

	static setLogLevel(logLevel: LogLvl) {
		Logger.logLevel = logLevel;
	}

	static debug(...args: unknown[]) {
		if (Logger.logLevel <= LogLvl.DEBUG) console.debug("[S2B]", ...args);
	}

	static log(...args: unknown[]) {
		if (Logger.logLevel <= LogLvl.INFO) console.log("[S2B]", ...args);
	}

	static info(...args: unknown[]) {
		if (Logger.logLevel <= LogLvl.INFO) console.info("[S2B]", ...args);
	}

	static warn(...args: unknown[]) {
		if (Logger.logLevel <= LogLvl.WARN) console.warn("[S2B]", ...args);
	}

	static error(...args: unknown[]) {
		if (Logger.logLevel <= LogLvl.ERROR) console.error("[S2B]", ...args);
	}
}

export { Logger };
