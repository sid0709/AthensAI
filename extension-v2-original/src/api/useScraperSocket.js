import { useEffect, useRef, useCallback } from 'react';
import useSocket from './useSocket';
import { SOCKET_PROTOCOL } from '../config/socket_protocol';

const HEARTBEAT_INTERVAL_MS = 5000;

export default function useScraperSocket({
	scraping = false,
	lastJobAt = null,
	onRestart,
}) {
	const { socket, status } = useSocket();
	const lastJobAtRef = useRef(lastJobAt);
	const onRestartRef = useRef(onRestart);

	lastJobAtRef.current = lastJobAt;
	onRestartRef.current = onRestart;

	const emitScraper = useCallback((purpose, extra = {}) => {
		if (!socket?.connected) return;
		socket.emit(SOCKET_PROTOCOL.TYPE.SCRAPER, {
			payload: {
				purpose,
				src: SOCKET_PROTOCOL.LOCATION.EXTENSION,
				tgt: SOCKET_PROTOCOL.LOCATION.BACKEND,
				socketId: socket.id,
				scraping,
				lastJobAt: lastJobAtRef.current,
				timestamp: new Date().toISOString(),
				...extra,
			},
		});
	}, [socket, scraping]);

	useEffect(() => {
		if (!socket || status !== 'connected') return undefined;

		const register = () => {
			emitScraper(SOCKET_PROTOCOL.IDENTIFIER.PURPOSE.REGISTER, { scraping });
		};

		const onScraperMessage = (data) => {
			const payload = data?.payload;
			if (!payload) return;
			if (payload.purpose !== SOCKET_PROTOCOL.IDENTIFIER.PURPOSE.RESTART) return;
			if (payload.tgt && payload.tgt !== SOCKET_PROTOCOL.LOCATION.EXTENSION) return;
			if (payload.socketId && payload.socketId !== socket.id) return;
			onRestartRef.current?.(payload);
		};

		register();
		socket.on('connect', register);
		socket.on(SOCKET_PROTOCOL.TYPE.SCRAPER, onScraperMessage);

		return () => {
			socket.off('connect', register);
			socket.off(SOCKET_PROTOCOL.TYPE.SCRAPER, onScraperMessage);
		};
	}, [socket, status, emitScraper, scraping]);

	useEffect(() => {
		if (!socket || status !== 'connected') return undefined;

		emitScraper(SOCKET_PROTOCOL.IDENTIFIER.PURPOSE.HEARTBEAT, { scraping });

		if (!scraping) return undefined;

		const interval = setInterval(() => {
			emitScraper(SOCKET_PROTOCOL.IDENTIFIER.PURPOSE.HEARTBEAT, { scraping: true });
		}, HEARTBEAT_INTERVAL_MS);

		return () => clearInterval(interval);
	}, [socket, status, scraping, emitScraper]);

	return { socketId: socket?.id ?? null, status };
}
