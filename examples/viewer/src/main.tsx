import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App";
import "./style.css";

createRoot(document.getElementById("root")!).render(
	<ThemeProvider
		attribute="class"
		defaultTheme="system"
		enableSystem
		disableTransitionOnChange
	>
		<App />
	</ThemeProvider>,
);
