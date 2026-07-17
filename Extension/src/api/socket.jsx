import { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_PROTOCOL } from '../config/socket_protocol';
import { SOCKET_URL } from '../config/env';

export const SocketContext = createContext({
	socket: null,
	status: 'unconfigured',
	serverInfo: null,
	socketUrl: null,
});

export function SocketProvider({ children }) {
	const socketUrl = SOCKET_URL;
	const socketRef = useRef(null);
	const [status, setStatus] = useState(socketUrl ? 'connecting' : 'unconfigured');
	const [serverInfo, setServerInfo] = useState(null);

	useEffect(() => {
		if (!socketUrl) {
			setStatus('unconfigured');
			setServerInfo(null);
			return undefined;
		}

		setStatus('connecting');
		setServerInfo(null);

		const socket = io(socketUrl, {
			transports: ['websocket', 'polling'],
			reconnection: true,
			reconnectionAttempts: Infinity,
		});
		socketRef.current = socket;

		const onConnect = () => {
			setStatus('connected');
			socket.emit(SOCKET_PROTOCOL.TYPE.CONNECTION, {
				payload: {
					purpose: SOCKET_PROTOCOL.IDENTIFIER.PURPOSE.CHECK_CONNECTIONS,
					src: SOCKET_PROTOCOL.LOCATION.EXTENSION,
					tgt: SOCKET_PROTOCOL.LOCATION.BACKEND,
					timestamp: new Date().toISOString(),
				},
			});
		};

		const onDisconnect = () => {
			setStatus('disconnected');
			setServerInfo(null);
		};

		const onHello = (data) => {
			if (data?.ok && data?.service === 'lancer-backend') {
				setServerInfo(data);
			}
		};

		const onProtocolReply = (data) => {
			const payload = data?.payload;
			if (
				payload?.purpose === SOCKET_PROTOCOL.IDENTIFIER.PURPOSE.CHECK_CONNECTIONS
				&& payload?.src === SOCKET_PROTOCOL.LOCATION.BACKEND
				&& payload?.tgt === SOCKET_PROTOCOL.LOCATION.EXTENSION
				&& payload?.ok
			) {
				setServerInfo((prev) => prev || { ok: true, service: 'lancer-backend' });
			}
		};

		const onReconnectAttempt = () => setStatus('connecting');

		socket.io.on('reconnect_attempt', onReconnectAttempt);
		socket.on('connect', onConnect);
		socket.on('disconnect', onDisconnect);
		socket.on('server:hello', onHello);
		socket.on(SOCKET_PROTOCOL.TYPE.CONNECTION, onProtocolReply);

		return () => {
			socket.io.off('reconnect_attempt', onReconnectAttempt);
			socket.off('connect', onConnect);
			socket.off('disconnect', onDisconnect);
			socket.off('server:hello', onHello);
			socket.off(SOCKET_PROTOCOL.TYPE.CONNECTION, onProtocolReply);
			socket.disconnect();
			socketRef.current = null;
		};
	}, [socketUrl]);

	const value = useMemo(
		() => ({
			socket: socketRef.current,
			status,
			serverInfo,
			socketUrl,
		}),
		[status, serverInfo, socketUrl],
	);

	return (
		<SocketContext.Provider value={value}>
			{children}
		</SocketContext.Provider>
	);
}
