import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [
        tailwindcss(),
        react({
            babel: {
                plugins: [["babel-plugin-react-compiler"]],
            },
        }),
    ],
    server: {
        host: "0.0.0.0",
        port: 5173,
        proxy: {
            "/games": "http://localhost:3001",
            "/engine": "http://localhost:3001",
            "/health": "http://localhost:3001",
            "/ready": "http://localhost:3001",
        },
    },
});
