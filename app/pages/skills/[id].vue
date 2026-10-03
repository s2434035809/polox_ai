<script setup lang="ts">
import { SKILL_CATEGORY_LABELS, normalizeSkillCategory } from '~~/shared/utils/skillCategory'

const route = useRoute()
const id = computed(() => String(route.params.id || ''))

interface SkillDetail {
  id: string
  name: string
  description?: string
  source?: 'builtin' | 'user'
  category?: string
  placeholder?: string
  enabled?: boolean
}

const { data, pending, error } = await useFetch<SkillDetail>(() => `/api/skills/${encodeURIComponent(id.value)}`, {
  watch: [id],
})

const lockedSkill = computed(() => {
  const skill = data.value
  if (!skill?.id)
    return undefined
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description || '',
    source: skill.source === 'user' ? 'user' as const : 'builtin' as const,
    placeholder: skill.placeholder || undefined,
  }
})

const categoryLabel = computed(() => SKILL_CATEGORY_LABELS[normalizeSkillCategory(data.value?.category)])
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1128px] flex-col gap-6">
    <p
      v-if="pending"
      class="text-sm text-muted-foreground"
    >
      Loading skill…
    </p>
    <p
      v-else-if="error || !data"
      class="text-sm text-destructive"
      role="alert"
    >
      This skill is not available.
    </p>
    <template v-else>
      <div class="flex flex-col gap-2">
        <NuxtLink
          to="/#skills"
          class="text-sm text-muted-foreground hover:text-foreground"
        >
          Skills
        </NuxtLink>
        <h1 class="text-3xl font-semibold tracking-tight">
          {{ data.name }}
        </h1>
        <p class="font-mono text-sm text-muted-foreground">
          /{{ data.id }}
        </p>
        <p
          v-if="data.description"
          class="max-w-2xl text-base leading-relaxed text-muted-foreground"
        >
          {{ data.description }}
        </p>
        <p class="text-xs text-muted-foreground">
          {{ categoryLabel }}
        </p>
      </div>
      <HomeAgentComposer
        :key="data.id"
        compact
        embedded
        :locked-skill="lockedSkill"
      />
    </template>
  </div>
</template>
