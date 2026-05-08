export function getDefaultServerUrl(): string {
	const m = window.location.pathname.match(/^\/renderer/)
	if (m && m.groups) {
		return `${window.location.origin}`
	}

	// In development-mode
	return `http://localhost:8000`
}

export function getNameSpaceId(): string {
	{
		// Using namespace mode
		// window.location.pathname = "/controller/large-wasteful-starfish/default/"
		const m = window.location.pathname.match(/^\/renderer\/(?<namespaceId>[^/]*)\/default/)
		if (m && m.groups) {
			return m.groups.namespaceId
		}
	}
	return ''
}
