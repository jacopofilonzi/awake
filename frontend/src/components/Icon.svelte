<script lang="ts">
  import { ICONS, type IconName } from "../lib/icons.ts";

  let { name, size = 24, class: cls = "" }: { name: IconName; size?: number; class?: string } = $props();
</script>

<!-- The SVGs come from the bundled Material Symbols package, never from user input. -->
<span class="icon inline-block shrink-0 {cls}" style:width="{size}px" style:height="{size}px" aria-hidden="true">{@html ICONS[name]}</span>
