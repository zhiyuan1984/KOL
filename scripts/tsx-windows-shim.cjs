if (typeof process.geteuid !== "function") process.geteuid = () => -1;
