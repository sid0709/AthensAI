import { SnackbarProvider } from 'notistack';
import { RuntimeProvider } from './runtime.jsx';
import { SocketProvider } from './socket.jsx';

const Providers = ({ children }) => {
	return (
		<SnackbarProvider maxSnack={4} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
			<SocketProvider>
				<RuntimeProvider>
					{children}
				</RuntimeProvider>
			</SocketProvider>
		</SnackbarProvider>
	);
};

export default Providers;
