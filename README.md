db4js
=====

A Simple light DB for Javascript

Usage
=====

Load from (empty) file:
<pre>
var myDb = Db.create();
myDb.loadFromFile("my.db", {
	keyField : "id",
	indexes : {
		id : Db.indexBuilders.fromKey
	}
}, "id");
</pre>

Read by ID:
<pre>
var id = "abcd"
myDb.get("id", id).then(function(data) {
	if(data.indexItems)
		doSomeThing(data.indexItems[0][0])
	else
		error("not found")
}, function(message) {
	error(message);
})
</pre>

Save:
<pre>
myDb.save("id", object, errorCB, true).then(function(data) {
		doSomething(data)
})
</pre>

API
===
loadFromFile = function(path, metadata, keyField)

loadData = function(data, metadata)

save = function(key, data, error, reindex)

delete = function(key, error)

listKeys = function(forKey, options)

get = function(index, key)

search = function(index, input, keyField, limit)

Index Builders
==============

indexBuilders.fromKey
indexBuilders.fromField
indexBuilders.fromAlias
indexBuilders.fromRecursive
indexBuilders.trigramFromIndex


Example 1
=========

<pre>
var itemsDb = Db.create();
var itemMetaData = {
	keyField : "text",
	indexes : {
		name : Db.indexBuilders.fromKey,
		unit : function(key, data) {
			return Db.indexBuilders.fromField(key, data, function(obj) {
				return obj.units;
			});
		},
		search : function(index, data) {
			return Db.indexBuilders.fromKey(index, data)
			.then(function(data) { 
				return Db.indexBuilders.trigramFromIndex(index, data)
			});
		},
		count : function(key, data) {
			return Db.indexBuilders.fromField(key, data, function(obj) {
				return obj.count;
			});
		}
	}
};
itemMetaData.indexes.count.sort = function(a, b){return a-b};
itemsDb.loadFromFile(dataFile, itemMetaData, 'text');
</pre>

Example 2
=========
<pre>
var recipeDb = Db.create();
var recipeMetaData = {
	keyField : "name",
	indexes : {
		recipeName : Db.indexBuilders.fromKey,
		recipeSearch : function(index, data) {
			return Db.indexBuilders.fromKey(index, data)
			.then(function(data) { 
				return Db.indexBuilders.trigramFromIndex(index, data)
			});
		},
		recipeIngredients : function(key, data) {
			return Db.indexBuilders.fromField(key, data, function(obj) {
				var toReturn = [];
				for (var i = obj.ingredients.length - 1; i >= 0; i--) {
					for (var j = obj.ingredients[i].length - 1; j >= 0; j--) {
						toReturn.push(obj.ingredients[i].i[j])
					};
				};

				return toReturn;
			} );
		}
	}
}

recipeDb.loadFromFile(recipeFile, recipeMetaData, 'name');
</pre>
