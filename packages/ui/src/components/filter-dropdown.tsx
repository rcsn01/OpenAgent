import { For, splitProps } from "solid-js"
import type { ComponentProps } from "solid-js"
import { DropdownMenu } from "./dropdown-menu"
import { Icon } from "./icon"

export interface FilterDropdownOption<TValue extends string = string> {
  value: TValue
  label: string
}

export interface FilterDropdownProps<TValue extends string = string>
  extends Omit<ComponentProps<"button">, "value" | "onChange"> {
  value: TValue
  options: FilterDropdownOption<TValue>[]
  onChange: (value: TValue) => void
  menuClass?: string
}

export function FilterDropdown<TValue extends string = string>(props: FilterDropdownProps<TValue>) {
  const [local, rest] = splitProps(props, ["value", "options", "onChange", "class", "classList", "menuClass", "children"])
  const selectedOption = () => local.options.find((option) => option.value === local.value) ?? local.options[0]

  return (
    <DropdownMenu gutter={4} placement="bottom-start">
      <DropdownMenu.Trigger
        {...rest}
        type="button"
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
      >
        {local.children ?? selectedOption()?.label}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class={local.menuClass}>
          <DropdownMenu.RadioGroup value={local.value} onChange={(value) => local.onChange(value as TValue)}>
            <For each={local.options}>
              {(option) => (
                <DropdownMenu.RadioItem value={option.value}>
                  <DropdownMenu.ItemLabel>{option.label}</DropdownMenu.ItemLabel>
                  <DropdownMenu.ItemIndicator>
                    <Icon name="check-small" size="small" class="text-icon-weak" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
