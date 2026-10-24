import React from "react";
import ReactDOM from "react-dom/client";
import AegisCare360App from "./AegisCare360App";
import "./index.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AegisCare360App />
    </React.StrictMode>
  );
}
