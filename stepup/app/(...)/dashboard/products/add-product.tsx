"use client";
import Image from "next/image";
import React, { useRef, useState } from "react";
import Draggable from "react-draggable";

interface Talle {
  [talle: string]: number;
}

const AddProduct = () => {
  const draggableRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState<FormData>(new FormData());
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

  const handleAddProduct = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Agregar los archivos al formData
    files.forEach((file, index) => {
      formData.append(`files[${index}]`, file);
    });

    // Enviar formData al servidor
    fetch("URL_DEL_SERVIDOR", {
      method: "POST",
      body: formData,
    })
      .then((response) => response.json())
      .then((data) => {
        console.log(data);
        closeModal();
      })
      .catch((error) => {
        console.error("Error:", error);
      });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles) {
      const filesArray = Array.from(selectedFiles);
      setFiles(filesArray);

      const newFormData = new FormData();
      filesArray.forEach((file, index) => {
        newFormData.append(`files[${index}]`, file);
      });
      setFormData(newFormData);
    }
  };

  const handleInputChange = (talle: string, cantidad: string, index: number) => {
    const newTalles = [...talles];
    newTalles[index][talle] = parseInt(cantidad);
    setTalles(newTalles);

    // Agregar los talles al formData
    const newFormData = new FormData();
    newTalles.forEach((talle, index) => {
      const talleKey = Object.keys(talle)[0];
      const talleValue = Object.values(talle)[0];
      newFormData.append(`talles[${talleKey}]`, talleValue.toString());
    });
    setFormData(newFormData);
  };

  console.log(formData);

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
            /*  onClick={handleAddProduct} */
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
                <label htmlFor="modelo" className="block mb-1 font-medium">
                  Modelo
                </label>
                <input
                  id="modelo"
                  name="modelo"
                  type="text"
                  onChange={(e) => setFormData({ ...formData, [e.target.name]: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-4 py-2"
                />
              </div>
              <div>
                <label htmlFor="marca" className="block mb-1 font-medium">
                  Marca
                </label>
                <input
                  type="text"
                  name="marca"
                  id="marca"
                  onChange={(e) => setFormData({ ...formData, [e.target.name]: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-4 py-2"
                />
              </div>
              <div>
                <label htmlFor="descripcion" className="block mb-1 font-medium">
                  descripcion
                </label>
                <input
                  type="text"
                  name="descripcion"
                  id="descripcion"
                  onChange={(e) => setFormData({ ...formData, [e.target.name]: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-4 py-2"
                />
              </div>
              <div>
                <label htmlFor="talles" className="block mb-1 font-medium">
                  Talles
                </label>
                <div className="flex flex-wrap gap-4">
                  {talles.map((talle, index) => (
                    <div key={index} className="flex items-center">
                      <label htmlFor={`cantidad-${index}`}>{Object.keys(talle)[0]}</label>
                      <input
                        type="number"
                        id={`cantidad-${index}`}
                        className="w-12 border border-gray-300 rounded-md px-2 py-1 ml-2"
                        min="0"
                        onChange={(e) =>
                          handleInputChange(Object.keys(talle)[0], e.target.value, index)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block mb-1 font-medium" htmlFor="color">
                  Color
                </label>
                <input
                  type="text"
                  name="color"
                  id="color"
                  className="w-full border border-gray-300 rounded-md px-4 py-2"
                  onChange={(e) => setFormData({ ...formData, [e.target.name]: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="file" className="block mb-1 font-medium">
                  Imagenes
                </label>
                <input
                  type="file"
                  id="file"
                  className="w-full border border-gray-300 rounded-md px-4 py-2"
                  multiple
                  accept=".jpg, .png, .avif, .svg"
                  onChange={handleFileChange}
                />
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
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-800 mr-4">
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
