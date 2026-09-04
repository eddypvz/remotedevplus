<script setup lang="ts">
import Empty from '../../ui/Empty.vue';
</script>

<template>
  <Empty
    icon="database"
    title="El cliente de base de datos llega en fase 3"
    hint="Se conectará a MySQL, Mongo y Redis como cliente, con credenciales de la configuración. No administra el servidor de base de datos: eso necesitaría privilegios que el agente no tiene a propósito."
  />
</template>
