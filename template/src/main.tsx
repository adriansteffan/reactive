import React from "react";
import ReactDOM from "react-dom/client";
import Experiment from "./Experiment";
import "@adriansteffan/reactive/style.css";
import "./index.css";
import { ExperimentProvider } from "@adriansteffan/reactive";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ExperimentProvider>
      <Experiment />
    </ExperimentProvider>
  </React.StrictMode>
);