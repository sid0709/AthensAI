import { SnackbarProvider } from 'notistack';
import { RuntimeProvider } from './runtime.jsx';
import { BackendHealthProvider } from './backendHealth.jsx';

const Providers = ({ children }) => {
	return (
		<SnackbarProvider
			maxSnack={4}
			anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
			dense
			hideIconVariant={false}
			style={{
				fontFamily: '"Figtree", system-ui, sans-serif',
			}}
		>
			<BackendHealthProvider>
				<RuntimeProvider>
					{children}
				</RuntimeProvider>
			</BackendHealthProvider>
		</SnackbarProvider>
	);
};

export default Providers;
