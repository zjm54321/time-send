import type {
	TuiCommand,
	TuiCommandApi,
	TuiPlugin,
	TuiPluginApi,
	TuiSlotPlugin,
	TuiSlots,
} from "@opencode-ai/plugin/tui";
import type { BoxRenderable, TextRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { onCleanup } from "solid-js";
import type { LoadConfigOptions } from "./config.js";
import { loadConfig, resolveConfigPath, resolveStatusPath } from "./config.js";
import { PLUGIN_ID } from "./server.js";
import { readStatus, type TimedSendStatus, writeStatus } from "./status.js";
import { formatCountdown } from "./time-window.js";

export interface TuiApi {
	readonly slots: Pick<TuiSlots, "register">;
	readonly command?: Pick<TuiCommandApi, "register">;
	readonly ui: Pick<TuiPluginApi["ui"], "toast">;
	readonly lifecycle: Pick<TuiPluginApi["lifecycle"], "onDispose">;
	readonly state?: {
		readonly path?: {
			readonly config?: string;
			readonly directory?: string;
		};
	};
}

export interface TuiOptions {
	readonly configPath?: string;
	readonly directory?: string;
	readonly now?: () => Date;
	readonly readText?: LoadConfigOptions["readText"];
	readonly readStatus?: (path: string) => Promise<TimedSendStatus | undefined>;
	readonly writeStatus?: (
		path: string,
		status: TimedSendStatus,
	) => Promise<void>;
}

export interface TuiModule {
	readonly id: typeof PLUGIN_ID;
	readonly tui: TuiPlugin;
}

type StatusSubscriber = () => void;
type StatusSubscription = (subscriber: StatusSubscriber) => () => void;

export async function timedSendTui(
	api: TuiApi,
	options: TuiOptions = {},
): Promise<void> {
	const directory =
		options.directory ?? api.state?.path?.config ?? api.state?.path?.directory;
	const loadOptions = toLoadConfigOptions(directory, options);
	const configPath = resolveConfigPath(loadOptions);
	const config = await loadConfig(loadOptions);
	const statusPath = resolveStatusPath(config, configPath);
	const readStatusFn = options.readStatus ?? readStatus;
	const currentDate = (): Date => options.now?.() ?? new Date();
	let currentStatus = await readStatusFn(statusPath);
	let currentNow = currentDate();
	const subscribers = new Set<StatusSubscriber>();
	const render = (): string => formatStatusLine(currentStatus, currentNow);
	const subscribe: StatusSubscription = (subscriber) => {
		subscribers.add(subscriber);
		subscriber();
		return () => {
			subscribers.delete(subscriber);
		};
	};
	const notify = (): void => {
		for (const subscriber of subscribers) {
			subscriber();
		}
	};

	const slotPlugin = createSlotPlugin(
		config.display.promptRight || config.display.appBottom,
		render,
		subscribe,
	);
	if (slotPlugin !== undefined) {
		api.slots.register(slotPlugin);
	}

	const refresh = async (): Promise<void> => {
		currentNow = currentDate();
		currentStatus = await readStatusFn(statusPath);
		notify();
	};

	const releaseNow = async (): Promise<void> => {
		await refresh();
		if (currentStatus?.state !== "waiting") {
			api.ui.toast({ message: render() });
			return;
		}
		const released: TimedSendStatus = {
			schemaVersion: 1,
			state: "released",
			...(currentStatus.sessionID === undefined
				? {}
				: { sessionID: currentStatus.sessionID }),
			startedAt: currentDate().toISOString(),
			windowStart: currentStatus.windowStart,
			windowEnd: currentStatus.windowEnd,
			configPath,
		};
		await (options.writeStatus ?? writeStatus)(statusPath, released);
		currentNow = currentDate();
		currentStatus = released;
		notify();
		api.ui.toast({ message: "timed-send released now" });
	};

	const disposeCommand = api.command?.register(
		() =>
			[
				{
					title: "Timed send status",
					value: `${PLUGIN_ID}.status`,
					description: "Show the timed-send window and countdown status",
					category: "Timed Send",
					slash: { name: "timed-send-status" },
					onSelect: async (): Promise<void> => {
						await refresh();
						api.ui.toast({ message: render() });
					},
				},
				{
					title: "Send now",
					value: `${PLUGIN_ID}.send-now`,
					description: "Release the current timed-send wait immediately",
					category: "Timed Send",
					slash: { name: "time-send-now" },
					onSelect: releaseNow,
				},
			] satisfies TuiCommand[],
	);
	const interval = setInterval(() => {
		void refresh();
	}, 1000);
	api.lifecycle.onDispose(() => {
		clearInterval(interval);
		disposeCommand?.();
	});
}

export function TimedSendSidebar(props: {
	readonly render: () => string;
	readonly subscribe: StatusSubscription;
}): JSX.Element {
	let container: BoxRenderable | undefined;
	let statusText: TextRenderable | undefined;
	let unsubscribe: (() => void) | undefined;
	const update = (): void => {
		const value = props.render();
		if (container !== undefined) {
			container.visible = value.length > 0;
			container.requestRender();
		}
		if (statusText !== undefined) {
			statusText.content = value;
			statusText.requestRender();
		}
	};
	const subscribeWhenReady = (): void => {
		if (
			unsubscribe === undefined &&
			container !== undefined &&
			statusText !== undefined
		) {
			unsubscribe = props.subscribe(update);
		}
	};
	onCleanup(() => {
		unsubscribe?.();
	});
	return (
		<box
			ref={(node) => {
				container = node;
				subscribeWhenReady();
			}}
			flexDirection="column"
		>
			<text>
				<b>Timed send</b>
			</text>
			<text
				ref={(node) => {
					statusText = node;
					subscribeWhenReady();
				}}
			>
				{props.render()}
			</text>
		</box>
	);
}

function createSlotPlugin(
	showSidebar: boolean,
	render: () => string,
	subscribe: StatusSubscription,
): TuiSlotPlugin | undefined {
	if (!showSidebar) {
		return undefined;
	}
	return {
		order: 150,
		slots: {
			sidebar_content: () => (
				<TimedSendSidebar render={render} subscribe={subscribe} />
			),
		},
	};
}

export function formatStatusLine(
	status: TimedSendStatus | undefined,
	now: Date,
): string {
	if (status === undefined) {
		return "";
	}
	if (status.state === "waiting" && status.nextStartAt !== undefined) {
		const nextStart = new Date(status.nextStartAt);
		const countdown = formatCountdown(nextStart.getTime() - now.getTime());
		return `${status.windowStart} in ${countdown}`;
	}
	if (status.state === "error") {
		return "timed-send error";
	}
	if (status.state === "open") {
		return `window open until ${status.windowEnd}`;
	}
	return "";
}

export const formatStatus = formatStatusLine;

const tuiModule: TuiModule = {
	id: PLUGIN_ID,
	tui: timedSendTui,
};

export default tuiModule;

function toLoadConfigOptions(
	directory: string | undefined,
	options: TuiOptions,
): LoadConfigOptions {
	return {
		...(options.configPath === undefined
			? {}
			: { configPath: options.configPath }),
		...(directory === undefined ? {} : { directory }),
		...(options.readText === undefined ? {} : { readText: options.readText }),
	};
}
