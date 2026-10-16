<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  let {
    label,
    value = $bindable(""),
    hint = "",
    error = "",
    mono = false,
    id = `f-${Math.random().toString(36).slice(2, 9)}`,
    ...rest
  }: { label: string; value?: string; hint?: string; error?: string; mono?: boolean; id?: string } & Omit<HTMLInputAttributes, "value"> = $props();
</script>

<div>
  <label class="field-label" for={id}>{label}</label>
  <input {id} class="input {mono ? 'font-mono' : ''} {error ? 'border-error ring-1 ring-error' : ''}" bind:value aria-invalid={!!error} {...rest} />
  {#if error}<p class="hint text-error!">{error}</p>{:else if hint}<p class="hint">{hint}</p>{/if}
</div>
