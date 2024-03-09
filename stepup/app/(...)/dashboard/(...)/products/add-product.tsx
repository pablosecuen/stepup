"use client";
import Image from "next/image";
import React, { useRef, useState } from "react";
import Draggable from "react-draggable";
import { ref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/firebase";
import { addDoc, collection } from "firebase/firestore";

interface Talle {
  [talle: string]: number;
}

const AddProduct = () => {
  const draggableRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    modelo: "",
    marca: "",
    descripcion: "",
    color: "",
    categoria: "",
    precio: 0,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [talles, setTalles] = useState<Talle[]>([
    { "40": 0 },
    { "41": 0 },
    { "42": 0 },
    { "43": 0 },
    { "44": 0 },
    { "45": 0 },
  ]);

  const openModal = () => {
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
  };

  const handleAddProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      const uploadTasks = files.map(async (file) => {
        const storageRef = ref(storage, `images/${file.name}`);
        await uploadBytes(storageRef, file);
        return `images/${file.name}`;
      });

      const urls = await Promise.all(uploadTasks);

      const productData = {
        ...formData,
        talles: talles,
        imagenes: urls,
        status: true,
      };

      await addDoc(collection(db, "products"), productData);
      console.log("Producto agregado correctamente a Firestore");

      closeModal();
    } catch (error) {
      console.error("Error al agregar producto:", error);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles) {
      const filesArray = Array.from(selectedFiles);
      setFiles(filesArray);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prevState) => ({
      ...prevState,
      [name]: value,
    }));
  };

  const handleTalleChange = (talle: string, cantidad: string, index: number) => {
    const newTalles = [...talles];
    newTalles[index][talle] = parseInt(cantidad);
    setTalles(newTalles);
  };

  return (
    <div>
      <button
        onClick={openModal}
        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
      >
        Add Product
      </button>
      {isOpen && (
        <Draggable handle=".modal-header" ref={draggableRef}>
          <form
            onSubmit={handleAddProduct}
            className="fixed top-20 left-1/2 transform -translate-x-1/2  bg-white p-8 rounded-lg shadow-black shadow-2xl"
          >
            <div
              className="flex justify-between items-center mb-4 cursor-move modal-header"
              ref={draggableRef}
            >
              <h2 className="text-xl font-semibold">Add Product</h2>
              <button
                onClick={closeModal}
                className="text-gray-500 hover:text-gray-800 cursor-pointer"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  ></path>
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <input
                  placeholder="modelo"
                  type="text"
                  name="modelo"
                  value={formData.modelo}
                  onChange={handleInputChange}
                />
              </div>
              <div>
                <input
                  type="text"
                  name="marca"
                  placeholder="marca"
                  value={formData.marca}
                  onChange={handleInputChange}
                />
              </div>
              <div>
                <input
                  type="text"
                  placeholder="categoria"
                  name="categoria"
                  id="categoria"
                  value={formData.categoria}
                  onChange={handleInputChange}
                />
              </div>
              <div>
                <input
                  type="text"
                  placeholder="descripcion"
                  name="descripcion"
                  id="descripcion"
                  value={formData.descripcion}
                  onChange={handleInputChange}
                />
              </div>

              <div>
                <input
                  type="text"
                  name="color"
                  placeholder="color"
                  value={formData.color}
                  onChange={handleInputChange}
                />
              </div>
              <div>
                <input
                  type="number"
                  name="precio"
                  placeholder="precio"
                  value={formData.precio}
                  onChange={handleInputChange}
                />
              </div>

              <div>
                <label htmlFor="talles" className="block mb-1 font-medium">
                  Talles
                </label>
                <div className="flex flex-wrap gap-4">
                  {talles.map((talle, index) => (
                    <div key={index} className="flex items-center">
                      <input
                        type="text"
                        value={Object.keys(talle)[0]}
                        disabled
                        className="w-12 border border-gray-300 rounded-md px-2 py-1 ml-2"
                      />
                      <input
                        type="number"
                        min="0"
                        value={Object.values(talle)[0]}
                        className="w-12 border border-gray-300 rounded-md px-2 py-1 ml-2"
                        onChange={(e) =>
                          handleTalleChange(Object.keys(talle)[0], e.target.value, index)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <input type="file" placeholder="imagenes" onChange={handleFileChange} multiple />
                {files.length > 0 && (
                  <div className="mt-4">
                    <h2 className="text-lg font-semibold">Selected Files:</h2>
                    <ul className=" flex items-center gap-2">
                      {files.map((file, index) => (
                        <li key={index}>
                          {" "}
                          <Image
                            width={0}
                            height={0}
                            src={URL.createObjectURL(file)}
                            alt={file.name}
                            className="h-24 w-auto"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-8 flex justify-end">
              <button
                type="button"
                onClick={closeModal}
                className="text-gray-500 hover:text-gray-800 mr-4"
              >
                Close
              </button>
              <button
                type="submit"
                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              >
                Add Product
              </button>
            </div>
          </form>
        </Draggable>
      )}
    </div>
  );
};

export default AddProduct;
