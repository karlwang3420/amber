<template>
	<UApp>
		<NuxtRouteAnnouncer />
		<NuxtPage />
	</UApp>
</template>

<script setup lang="ts">
	const colorMode = useColorMode();
	colorMode.preference = "dark";
</script>
