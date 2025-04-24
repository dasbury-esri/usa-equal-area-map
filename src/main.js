import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app.js"
import "./css/style.css";

ReactDOM.createRoot(document.getElementById("mainViewDiv")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );


