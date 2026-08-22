import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `PixiRenderer.init()` awaits `app.init()`, which creates a WebGL context — a
 * real async gap. Two defects lived in that window:
 *
 *  1. `destroy()` called `this.app.destroy()` unconditionally. `new Application()`
 *     assigns `this.app` synchronously, so tearing down mid-init destroyed a
 *     renderer that was never created, which throws and aborts the caller's
 *     remaining cleanup.
 *  2. `init()` kept building after the await even when the owner had already
 *     destroyed it — registering a shared-ticker callback nothing would remove.
 */

/** Resolves only when the test says so, standing in for WebGL context creation. */
const { appDestroy, appInit, tickerAdd, tickerRemove, ctl } = vi.hoisted(() => {
	const ctl: { release?: () => void } = {};
	return {
		ctl,
		appDestroy: vi.fn(),
		appInit: vi.fn(
			() =>
				new Promise<void>((resolve) => {
					ctl.release = resolve;
				}),
		),
		tickerAdd: vi.fn(),
		tickerRemove: vi.fn(),
	};
});

vi.mock("pixi.js", () => {
	class Application {
		init = appInit;
		destroy = appDestroy;
		canvas = document.createElement("canvas");
		stage = { addChild: vi.fn(), removeChild: vi.fn() };
		renderer = { resize: vi.fn(), render: vi.fn() };
	}
	class Container {
		children: unknown[] = [];
		addChild = vi.fn();
		removeChild = vi.fn();
		destroy = vi.fn();
	}
	return {
		Application,
		Container,
		Graphics: Container,
		Sprite: Container,
		Text: Container,
		Texture: { WHITE: {} },
		Ticker: { shared: { add: tickerAdd, remove: tickerRemove } },
	};
});

vi.mock("pixi-viewport", () => ({
	Viewport: class {
		dirty = false;
		x = 0;
		y = 0;
		scaled = 1;
		scale = { x: 1, y: 1 };
		plugins = { get: vi.fn(), remove: vi.fn() };
		drag = () => this;
		pinch = () => this;
		wheel = () => this;
		decelerate = () => this;
		clampZoom = () => this;
		animate = () => this;
		moveCenter = vi.fn();
		setZoom = vi.fn();
		resize = vi.fn();
		toScreen = (x: number, y: number) => ({ x, y });
		toWorld = (x: number, y: number) => ({ x, y });
		addChild = vi.fn();
		on = vi.fn();
	},
}));

import { PixiRenderer } from "../../src/components/graph/pixiRenderer";

const THEME = {} as never;

function makeContainer(): HTMLElement {
	const el = document.createElement("div");
	el.getBoundingClientRect = () => ({ width: 800, height: 600 }) as DOMRect;
	return el;
}

beforeEach(() => {
	appInit.mockClear();
	appDestroy.mockClear();
	tickerAdd.mockClear();
	tickerRemove.mockClear();
	ctl.release = undefined;
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("PixiRenderer teardown during init", () => {
	it("does not destroy a pixi Application whose init never resolved", () => {
		const renderer = new PixiRenderer();
		void renderer.init(makeContainer(), THEME);

		// The owner tears down while `app.init()` is still pending.
		expect(() => renderer.destroy()).not.toThrow();
		// Regression: this used to call destroy() on an uninitialized Application.
		expect(appDestroy).not.toHaveBeenCalled();
	});

	it("releases the context itself when init resolves after a destroy", async () => {
		const renderer = new PixiRenderer();
		const initPromise = renderer.init(makeContainer(), THEME);

		renderer.destroy();
		ctl.release?.();
		await initPromise;

		// The context finished being created after we gave up on it, so init()
		// unwinds it rather than leaving a live WebGL context orphaned.
		expect(appDestroy).toHaveBeenCalledTimes(1);
		// And it must not have gone on to build the scene graph / register a
		// shared-ticker callback that nothing would ever remove.
		expect(tickerAdd).not.toHaveBeenCalled();
	});

	it("stays idempotent when torn down twice during init", () => {
		const renderer = new PixiRenderer();
		void renderer.init(makeContainer(), THEME);

		renderer.destroy();
		renderer.destroy();

		expect(appDestroy).not.toHaveBeenCalled();
	});

	it("unwinds the context exactly once after repeated destroys", async () => {
		const renderer = new PixiRenderer();
		const initPromise = renderer.init(makeContainer(), THEME);

		renderer.destroy();
		renderer.destroy();
		ctl.release?.();
		await initPromise;

		// init()'s post-await unwind runs once, not once per destroy() call.
		expect(appDestroy).toHaveBeenCalledTimes(1);
	});

	// Note: the fully-initialized teardown path (scene graph built, then destroy)
	// is not unit-tested here. Driving `init()` past its await pulls in most of
	// pixi's surface (CanvasSource, RenderTexture, filters, …); mocking all of it
	// would make the test a test of the mock. That path is exercised for real
	// whenever the graph view opens and closes — the defects fixed here were
	// specifically about the window BEFORE init resolves, which is what the cases
	// above pin down.
});
