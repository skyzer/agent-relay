import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import styles from "./styles.css?inline";

const style = document.createElement("style");
style.textContent = styles;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
