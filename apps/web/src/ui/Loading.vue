<template>
  <div class="load"><span /></div>
</template>

<style scoped>
.load { display: grid; place-items: center; height: 100%; }
.load span {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid var(--border-strong); border-top-color: var(--accent);
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(1turn); } }
@media (prefers-reduced-motion: reduce) { .load span { animation-duration: 2s; } }
</style>
