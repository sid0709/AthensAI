import { Box, Stack, Tooltip, Typography } from '@mui/material';
import useBackendHealth from '../api/useBackendHealth';

const LIGHT = {
	off: 'rgba(255,255,255,0.12)',
	red: '#ef4444',
	yellow: '#eab308',
	green: '#22c55e',
};

function TrafficDot({ color, active, label }) {
	return (
		<Box
			aria-label={label}
			sx={{
				width: 11,
				height: 11,
				borderRadius: '50%',
				bgcolor: active ? color : LIGHT.off,
				boxShadow: active ? `0 0 8px ${color}` : 'none',
				transition: 'background-color 0.2s ease, box-shadow 0.2s ease',
			}}
		/>
	);
}

function statusMeta(status, serverInfo, apiUrl) {
	switch (status) {
		case 'connected':
			return serverInfo?.ok
				? {
					label: 'Backend online',
					detail: `REST API healthy at ${apiUrl || 'backend'}`,
					active: 'green',
				}
				: {
					label: 'Connecting…',
					detail: 'Waiting for backend handshake',
					active: 'yellow',
				};
		case 'connecting':
			return {
				label: 'Connecting…',
				detail: apiUrl ? `Checking ${apiUrl}` : 'Connecting',
				active: 'yellow',
			};
		case 'disconnected':
			return {
				label: 'Backend offline',
				detail: apiUrl ? `Cannot reach ${apiUrl}` : 'REST API unavailable',
				active: 'red',
			};
		default:
			return {
				label: 'Backend not configured',
				detail: 'Set VITE_API_URL and reload',
				active: 'red',
			};
	}
}

export default function BackendTrafficLight() {
	const { status, serverInfo, apiUrl } = useBackendHealth();
	const meta = statusMeta(status, serverInfo, apiUrl);

	const redOn = meta.active === 'red';
	const yellowOn = meta.active === 'yellow';
	const greenOn = meta.active === 'green';

	return (
		<Tooltip title={`${meta.label} — ${meta.detail}`} arrow>
			<Stack direction="row" alignItems="center" spacing={1.25} sx={{ userSelect: 'none' }}>
				<Box
					sx={{
						display: 'flex',
						alignItems: 'center',
						gap: 0.6,
						px: 1,
						py: 0.6,
						borderRadius: 1.5,
						bgcolor: 'rgba(0,0,0,0.35)',
						border: '1px solid',
						borderColor: 'divider',
					}}
				>
					<TrafficDot color={LIGHT.red} active={redOn} label="offline" />
					<TrafficDot color={LIGHT.yellow} active={yellowOn} label="connecting" />
					<TrafficDot color={LIGHT.green} active={greenOn} label="online" />
				</Box>
				<Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
					{meta.label}
				</Typography>
			</Stack>
		</Tooltip>
	);
}
