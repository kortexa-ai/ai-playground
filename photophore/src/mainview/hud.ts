export function createHud() {
	const statFps = document.getElementById("stat-fps")!;
	const statParticles = document.getElementById("stat-particles")!;
	const statSource = document.getElementById("stat-source")!;
	const fmt = new Intl.NumberFormat("en-US");

	return {
		setStats(fps: number, particles: number) {
			statFps.textContent = `${fps.toFixed(0)} fps`;
			statParticles.textContent = `${fmt.format(particles)} motes`;
		},
		setSource(label: string, modeName: string) {
			statSource.textContent = `${label} · ${modeName}`;
		},
	};
}
