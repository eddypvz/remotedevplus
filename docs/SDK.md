# El Claude Agent SDK en remotedevplus

Qué usamos, qué no, y cómo enterarse cuando el SDK cambia.

El paquete es `@anthropic-ai/claude-agent-sdk` — Claude Code empaquetado como
librería. **Autentica con el login que ya tiene el CLI**, así que consume la
suscripción y no pide `ANTHROPIC_API_KEY`.

## Cuando el SDK se actualiza

Está en 0.x y se mueve rápido. Leer el changelog a mano no escala, así que la
superficie está fotografiada en `docs/sdk-surface.json`:

```bash
npm run sdk:check      # ¿qué cambió respecto de la foto?
npm run sdk:snapshot   # aceptar los cambios y actualizar la foto
```

`sdk:check` compara opciones, funciones exportadas, métodos de `Query`, tipos de
`SDKMessage` y modos de permiso. Marca en verde lo que apareció y en rojo lo que
desapareció, y **sale con error solo si desapareció algo que usamos** — que es
la única situación urgente. Lo nuevo es una oportunidad, no un incendio.

El flujo al actualizar: `npm update @anthropic-ai/claude-agent-sdk`,
`npm run sdk:check`, mirar lo verde por si vale la pena adoptarlo, arreglar lo
rojo si lo había, `npm run sdk:snapshot`, `npm run check`.

## Lo que usamos hoy

| | Para qué |
|---|---|
| `query({ prompt, options })` | El motor. `prompt` es un AsyncIterable, y eso convierte una llamada suelta en una conversación viva |
| `cwd` | Directorio de trabajo, validado contra las raíces del usuario |
| `model`, `permissionMode` | Al lanzar; también en caliente por `Query` |
| `resume` | Reanudar una conversación guardada |
| `canUseTool` | Permisos como diálogo, y las respuestas de `AskUserQuestion` por `updatedInput` |
| `abortController` | Interrumpir un turno |
| `includePartialMessages` | Texto token a token. Los fragmentos se emiten en vivo y **no** entran al buffer: son cientos por respuesta y el mensaje completo llega detrás |
| `pathToClaudeCodeExecutable` | Apuntar al `claude` ya instalado en vez del que trae el SDK |
| `Query.setModel`, `Query.setPermissionMode`, `Query.interrupt` | Cambios en caliente |
| `listSessions`, `getSessionMessages` | El historial, leído de su fuente |
| `renameSession`, `deleteSession` | Gestión del historial |
| `result.modelUsage`, `result.total_cost_usd` | El medidor de tokens y costo. Acumulados por turno: se **leen**, no se suman |
| `system/thinking_tokens` | Lo único que el SDK reporta en vivo durante el turno |

## Lo que NO usamos, ordenado por lo que aportaría

Son 66 opciones en total; usamos 9. Esto es el resto, agrupado por qué daría.

### Vale la pena mirar pronto

| Opción | Qué daría |
|---|---|
| `effort` | `low`–`max`. Bajarlo en tareas simples ahorra cuota; subirlo mejora lo difícil |
| `thinking`, `maxThinkingTokens` | Controlar el pensamiento. Con `display: 'summarized'` se vería el razonamiento en vez de un silencio largo |
| `maxBudgetUsd`, `taskBudget` | Techo de gasto por conversación. Relevante si algún día hay varios devs |
| `enableFileCheckpointing` + `Query.rewindFiles()` | Deshacer los cambios de archivos hasta un mensaje. Es el "Rewind" del plugin de VS Code |
| `promptSuggestions` | Sugerencias de qué preguntar después |
| `title` | Ponerle nombre a la sesión al crearla, en vez de esperar el autogenerado |

### Depende de si sumamos MCP o subagentes

| Opción | Qué daría |
|---|---|
| `mcpServers`, `strictMcpConfig` | Servidores MCP |
| `onElicitation` | Formularios con casillas y radios pedidos por un servidor MCP, con JSON Schema. **Es el único lugar del SDK con formularios de verdad**; las preguntas de Claude (`AskUserQuestion`) son otra cosa |
| `agents`, `agent` | Subagentes con su propio prompt y herramientas |
| `agentProgressSummaries`, `forwardSubagentText` | Ver qué hacen los subagentes |
| `plugins`, `skills` | Plugins y skills |

### Control fino de herramientas y permisos

| Opción | Qué daría |
|---|---|
| `allowedTools`, `disallowedTools` | Listas blancas y negras por conversación |
| `additionalDirectories` | Carpetas extra fuera del cwd. **Ojo**: se saltaría nuestra frontera de raíces si se expone sin validar |
| `hooks`, `includeHookEvents` | Interceptar antes y después de cada herramienta. Es otra capa de control además de `canUseTool` |
| `permissionPrompts` | `'none'` desactiva los prompts por completo |
| `sandbox` | Ejecución aislada |
| `toolConfig` | Hoy solo `askUserQuestion.previewFormat`: los previews de las opciones pueden venir en HTML en vez de markdown |
| `onUserDialog`, `supportedDialogKinds` | Diálogos genéricos del CLI que el host puede renderizar |

### Sesiones e infraestructura

| Opción | Qué daría |
|---|---|
| `forkSession` | Reanudar creando una sesión nueva en vez de continuar la vieja |
| `resumeSessionAt` | Reanudar desde un mensaje puntual |
| `sessionId` | Fijar el id en vez de dejar que lo genere |
| `sessionStore`, `persistSession` | Guardar las sesiones en otro lado — la salida a que cada dev tenga las suyas separadas (ver *Pendiente* en ARCHITECTURE.md) |
| `settingSources`, `settings`, `managedSettings` | De dónde salen los ajustes |
| `env`, `executable`, `extraArgs` | Cómo se lanza el proceso |
| `stderr`, `debug`, `debugFile` | Diagnóstico |
| `systemPrompt`, `planModeInstructions` | Cambiar las instrucciones base |
| `fallbackModel` | Modelo de respaldo si el principal no está disponible |
| `maxTurns` | Techo de vueltas por turno |
| `continue` | Seguir la última conversación del directorio |
| `allowDangerouslySkipPermissions` | Saltarse todos los permisos |

## Las herramientas de Claude, por grupo

Un inventario que circula dice qué tiene que implementar "una consola" para
cada grupo de herramientas. Verificado contra este proyecto, **la mayoría no es
nuestra responsabilidad**: usamos el Agent SDK, que ES el host — trae el CLI
adentro y ya resuelve la carga de herramientas, `ToolSearch`, los
system-reminder, el archivo de plan y las tareas en background. Nosotros
implementamos la presentación y el `canUseTool`.

| Grupo | Quién lo resuelve | Estado |
|---|---|---|
| **Interactivos** (`AskUserQuestion`, `ExitPlanMode`, `EnterPlanMode`, `Enter/ExitWorktree`) | nosotros, por `canUseTool` | ✅ las dos primeras con UI propia; las otras con frase legible y permitir/denegar |
| **Con permiso** (`Bash`, `Edit`, `Write`, MCP) | nosotros, por `canUseTool` | ✅ y las llamadas paralelas se resuelven independientes: cada una recibe su propio id y su promesa |
| **Asíncronos** (`Agent`, `Workflow`, `Bash` en background, `Monitor`, `TaskOutput`) | el CLI las corre; nosotros las mostramos | ✅ se siguen por `task_started` / `task_progress` / `task_notification`, y se reenvían al reconectar |
| **Salida estructurada** (`TodoWrite`, `ReportFindings`, `Artifact`) | nosotros | 🟡 `TodoWrite` se renderiza como lista; los otros dos caen en la fila genérica desplegable |
| **Multi-agente** (`ListAgents`, `SendMessage`, `RemoteTrigger`) | el CLI | ⬜ se ven como herramientas comunes. Solo importa con varias sesiones |
| **`ToolSearch` y herramientas diferidas** | **el CLI, no nosotros** | ✅ nada que hacer: los schemas nunca cruzan el SDK, `ToolSearch` llega como un `tool_use` más |
| **`Skill` y slash commands** | el CLI | ✅ funcionan; se ven como herramientas |

Dos cosas del inventario que verifiqué y **no** eran así acá:

- *"`ExitPlanMode` no recibe el plan como parámetro, lee el archivo del plan"*.
  Su input trae **las dos cosas**: `plan` con el markdown completo y
  `planFilePath` con la ruta. Se renderiza el markdown en un modal; la ruta se
  muestra como dato y no como enlace, porque el archivo vive en
  `~/.claude/plans/` — abrirlo obligaría a agregar `~/.claude` a las raíces del
  usuario, y no hace falta: el contenido ya está en la mano.
- *"Hay que inyectar el system-reminder con la ruta del plan"*. Eso lo hace el
  CLI adentro del SDK; un host que hable el protocolo crudo sí tendría que
  hacerlo.

## Cosas aprendidas que no están documentadas

- **`AskUserQuestion` no se contesta permitiéndola.** Las respuestas vuelven
  dentro de su propio input, en `answers`, por el `updatedInput` de
  `canUseTool`. Permitirla a secas la ejecuta sin nadie que conteste.
- **El modo `dontAsk` también se traga las preguntas**, no solo los permisos.
  Probando los cinco modos, es el único: `bypassPermissions` sí las entrega.
- **El SDK no devuelve el mensaje del propio usuario** en el flujo, así que la
  interfaz tiene que pintarlo por su cuenta.
- **`Query` sí tiene `setModel` y `setPermissionMode`**, aunque la documentación
  publicada diga que no.
- **`modelUsage` y `usage` no son lo mismo.** El SDK dice que `usage` es solo
  del bucle principal —deja afuera subagentes y llamadas internas— y que
  `modelUsage` es "el campo correcto para contabilidad". Los dos vienen
  **acumulados** por turno, así que se leen; sumarlos entre results duplica.
  Medido en una conversación real: el caché leído era 110k de 122k tokens, así
  que ignorarlo daría una cifra diez veces menor a la real.
- **`ExitPlanMode` llega como una herramienta cualquiera** por `canUseTool`, con
  el plan en markdown dentro de su input. No hay un tipo ni un evento propio.
- **El SDK no lleva una lista de archivos ni de planes.**
  `SDKFilesPersistedEvent` es de la Files API, otra cosa. Todo se calcula del
  historial: cada `Write`/`Edit`/`NotebookEdit` deja su ruta en un `tool_use`, y
  cada `ExitPlanMode` deja el plan entero en el suyo. Como el historial se lee
  del disco al reanudar, los planes de una conversación vieja aparecen solos —
  verificado.
- **El CLI no arranca hasta el primer mensaje.** El `system/init` —y con él la
  lista de herramientas y de slash commands— no existe antes de eso. Una UI que
  lo espere al conectar se queda esperando.
- **El init reporta el modelo real** (`claude-opus-5[1m]`), que no es el alias
  que se pasó (`opus`). Son campos distintos y conviene no pisarlos.
