export type Item<T> = { value: T; label: string; disabled?: boolean };
export type ValueFn<T> = (value: T) => string | number | boolean;

abstract class GenericSelectState<T extends NonNullable<unknown>> {
	public items: Item<T>[] = $state([]);
	public valueFn?: ValueFn<T>;
	public search = $state('');
	public open = $state(false);

	constructor(items: Item<T>[], valueFn?: ValueFn<T>) {
		this.items = items;
		this.valueFn = valueFn;
	}

	get filteredItems() {
		return this.items.filter((item) =>
			item.label.toLowerCase().includes(this.search.toLowerCase()),
		);
	}

	getStringValue(itemValue: T): string {
		if (this.valueFn) return this.valueFn(itemValue).toString();

		return itemValue.toString();
	}
}

export class SelectSate<T extends NonNullable<unknown>> extends GenericSelectState<T> {
	public type = 'single' as const;

	private _selectedItem: Item<T> | undefined = $state(undefined);

	static create<U extends string | number | boolean>(items: Item<U>[]): SelectSate<U>;
	static create<U extends NonNullable<unknown>>(
		items: Item<U>[],
		valueFn: ValueFn<U>,
	): SelectSate<U>;
	static create<U extends NonNullable<unknown>>(
		items: Item<U>[],
		valueFn?: ValueFn<U>,
	): SelectSate<U> {
		return new SelectSate<U>(items, valueFn);
	}

	get value() {
		if (this._selectedItem === undefined) return undefined;
		return this.getStringValue(this._selectedItem.value);
	}

	public toggleItem(value: Item<T>) {
		if (this.selectedItem === value) {
			this._selectedItem = undefined;
		} else {
			this._selectedItem = value;
		}
	}

	public get selectedItem() {
		return this._selectedItem;
	}

	public get selectedValue() {
		return this._selectedItem?.value;
	}
}

export class MultiSelectSate<T extends NonNullable<unknown>> extends GenericSelectState<T> {
	public type = 'multiple' as const;

	private _selectedItem: Item<T>[] = $state([]);
	private _ordered = $state(false);

	static create<U extends string | number | boolean>(items: Item<U>[]): MultiSelectSate<U>;
	static create<U extends NonNullable<unknown>>(
		items: Item<U>[],
		valueFn: ValueFn<U>,
	): MultiSelectSate<U>;
	static create<U extends NonNullable<unknown>>(
		items: Item<U>[],
		valueFn?: ValueFn<U>,
	): MultiSelectSate<U> {
		return new MultiSelectSate<U>(items, valueFn);
	}

	get value() {
		return this._selectedItem.map((item) => this.getStringValue(item.value));
	}

	public ordered() {
		this._ordered = true;
		return this;
	}

	public toggleItem(value: Item<T>) {
		if (this.selectedItem.includes(value)) {
			this._selectedItem = this._selectedItem.filter((item) => item !== value);
		} else if (this._ordered) {
			this._selectedItem = this.items.filter(
				(item) => item === value || this._selectedItem.includes(item),
			);
		} else {
			this._selectedItem.push(value);
		}
	}

	public get selectedItem() {
		return this._selectedItem;
	}

	public get selectedValue() {
		return this._selectedItem.map((item) => item.value);
	}
}
