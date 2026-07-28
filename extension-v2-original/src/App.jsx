import {
	createTheme,
	ThemeProvider,
	CssBaseline,
	Container,
	Box,
} from "@mui/material";

import LayoutPage from "./components/layout";


const darkTheme = createTheme({
	palette: {
		mode: "dark",
	},
});

function App() {
	return (
		<ThemeProvider theme={darkTheme}>
			<CssBaseline />
			<Container maxWidth="sm" sx={{ py: 2 }}>
				<Box sx={{ textAlign: 'center', mb: 3 }}>
					<LayoutPage />
				</Box>
			</Container>
		</ThemeProvider>
	);
}

export default App;
