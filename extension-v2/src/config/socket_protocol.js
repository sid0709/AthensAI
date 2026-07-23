export const SOCKET_PROTOCOL = {
	TYPE: {
		CONNECTION: 'connection',
		SCRAPER: 'scraper',
	},
	LOCATION: {
		FRONTEND: 'frontend',
		BACKEND: 'backend',
		EXTENSION: 'extension',
	},
	IDENTIFIER: {
		PURPOSE: {
			CHECK_CONNECTIONS: 'check_connections',
			REGISTER: 'register',
			HEARTBEAT: 'heartbeat',
			RESTART: 'restart',
		},
	},
};

export const SCRAPER_RESTART_URL = 'https://jobright.ai/jobs/recommend';
