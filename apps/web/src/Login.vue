<script setup lang="ts">
import logo from './images/remotedevplus.png';
import { ref, onMounted } from 'vue';
import { useSession } from './stores/session';

const session = useSession();
const username = ref('');
const password = ref('');
const busy = ref(false);
const field = ref<HTMLInputElement>();

onMounted(() => field.value?.focus());

async function submit() {
  if (busy.value) return;
  busy.value = true;
  await session.login(username.value.trim(), password.value);
  password.value = '';
  busy.value = false;
}
</script>

<template>
  <div class="gate">
    <form class="card" @submit.prevent="submit">
      <div class="brand">
        <!--
          El logo es un wordmark horizontal, así que reemplaza al cuadrito y al
          título juntos. Lleva `alt` con el nombre porque si la imagen no carga
          la pantalla de login no debe quedarse sin decir de qué es.
        -->
        <img :src="logo" alt="RemoteDev+" class="logo">
        <p>desarrollo remoto</p>
      </div>

      <template v-if="session.setup">
        <p class="setup">
          El agente está activo pero todavía no hay ningún usuario. Cree el
          primero desde la terminal del servidor:
        </p>
        <pre class="cli">npm run user -- add &lt;nombre&gt; --admin</pre>
        <button type="button" class="go" @click="session.bootstrap()">ya está creado</button>
      </template>

      <template v-else>
        <label>
          <span>Usuario</span>
          <input
            ref="field" v-model="username" name="username"
            autocomplete="username" autocapitalize="off" autocorrect="off" required
          >
        </label>
        <label>
          <span>Contraseña</span>
          <input v-model="password" type="password" name="password" autocomplete="current-password" required>
        </label>

        <p v-if="session.error" class="err">{{ session.error }}</p>

        <button class="go" type="submit" :disabled="busy || !username || !password">
          {{ busy ? 'entrando…' : 'entrar' }}
        </button>
      </template>
    </form>
  </div>
</template>

<style scoped>
.gate {
  display: grid; place-items: center;
  height: 100dvh; padding: 1.5rem;
  /* Un degradado muy suave para que el login no se vea como un div vacío. */
  background:
    radial-gradient(60rem 40rem at 50% -10%, color-mix(in oklab, var(--accent) 12%, var(--bg)) 0%, transparent 60%),
    var(--bg);
}
.card {
  display: flex; flex-direction: column; gap: 15px;
  width: 100%; max-width: 22rem;
  padding: 26px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 18px 50px var(--shadow);
}
.brand { display: flex; flex-direction: column; gap: 5px; margin-bottom: 8px; }
/* Alto fijo y ancho automático: el wordmark mide 1401×217, y fijar el ancho lo
   deformaría en cuanto se cambie la imagen por otra de distinta proporción. */
.logo { height: 40px; width: auto; max-width: 100%; align-self: flex-start; }
.brand p { margin: 0; font-size: 12px; color: var(--fg-faint); }

label { display: flex; flex-direction: column; gap: 5px; }
label span { font-size: 12px; color: var(--fg-dim); }
input {
  /* 16px o iOS hace zoom al enfocar el campo. */
  height: var(--touch); padding: 0 11px;
  background: var(--bg); border: 1px solid var(--border-strong);
  border-radius: 8px; font-size: 16px;
}
input:focus { outline: none; border-color: var(--accent); }

.go {
  height: var(--touch); margin-top: 4px;
  background: var(--accent); color: var(--on-accent);
  border-radius: 8px; font-weight: 600;
}
.go:disabled { opacity: .45; cursor: default; }

.err { margin: 0; font-size: 12.5px; color: var(--danger); }
.setup { margin: 0; font-size: 13px; line-height: 1.6; color: var(--fg-dim); }
.cli {
  margin: 0; padding: 11px 13px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  font: 11.5px/1.5 var(--mono); color: var(--ok); overflow-x: auto;
}
</style>
