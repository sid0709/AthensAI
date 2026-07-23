import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Providers from './api/Providers.jsx'

createRoot(document.getElementById('root')).render(
	<Providers>
		<App />
	</Providers>
)
