// Vite imports a file as a string with ?raw (used for the admin page).
declare module "*?raw" {
	const text: string;
	export default text;
}
